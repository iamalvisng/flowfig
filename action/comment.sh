#!/usr/bin/env bash
# Verify every figure, then comment the diagram diff on the PR. Bash and gh only: no build, no dependency.
set -euo pipefail
shopt -s globstar nullglob

figures=()
for f in $FIGURES; do grep -q '<metadata id="figure-spec">' "$f" && figures+=("$f"); done
if [ ${#figures[@]} -eq 0 ]; then echo "flowfig: no figure with a spec under $FIGURES"; exit 0; fi

# verify.json has findings (with a figure each) and links (with a figure each). A fault exits 1 later, after the comment.
trap 'rm -f verify.json old.svg' EXIT
status=0
npx flowfig verify "${figures[@]}" --json > verify.json || status=$?
npx flowfig verify "${figures[@]}" || true

if [ "$COMMENT" != "true" ] || [ -z "${PR:-}" ]; then exit $status; fi

changed=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")
body="<!-- flowfig -->"$'\n'"## flowfig"$'\n'
for f in "${figures[@]}"; do
  if grep -qx "$f" <<< "$changed"; then
    body+=$'\n'"### \`$f\`"$'\n'
    if git cat-file -e "$BASE_SHA:$f" 2>/dev/null; then
      git show "$BASE_SHA:$f" > old.svg
      body+="| before | after |"$'\n'"|---|---|"$'\n'
      body+="| ![before](https://raw.githubusercontent.com/$REPO/$BASE_SHA/$f) | ![after](https://raw.githubusercontent.com/$REPO/$HEAD_SHA/$f) |"$'\n\n'
      body+="$(npx flowfig diff old.svg "$f" --md)"$'\n'
    else
      body+="New figure."$'\n\n'"![new](https://raw.githubusercontent.com/$REPO/$HEAD_SHA/$f)"$'\n'
    fi
  fi
done

# A figure whose linked file this PR changes: the figure may be stale. From the links list of verify --json.
stale=$(node -e '
  const { links } = JSON.parse(require("fs").readFileSync("verify.json", "utf8"));
  const changed = new Set(process.argv[1].split("\n"));
  const seen = new Set();
  for (const l of links) { const k = `${l.figure}|${l.path}`; if (changed.has(l.path) && !seen.has(k)) { seen.add(k); console.log(`- this PR changes \`${l.path}\`, linked from \`${l.figure}\`. Review the figure.`); } }
' "$changed")
if [ -n "$stale" ]; then body+=$'\n'"### Linked code changed"$'\n'"$stale"$'\n'; fi

faults=$(node -e '
  const { findings } = JSON.parse(require("fs").readFileSync("verify.json", "utf8"));
  for (const f of findings) console.log(`- ${f.severity} \`${f.rule}\` ${f.figure}: ${f.message}`);
')
if [ -n "$faults" ]; then body+=$'\n'"### verify"$'\n'"$faults"$'\n'; fi

if [ "$FORK" = "true" ]; then echo "flowfig: no comment on a fork PR (read-only token)"; exit $status; fi
# One comment per PR: update the earlier one, found by the marker.
id=$(gh api "repos/$REPO/issues/$PR/comments" --paginate --jq '.[] | select(.body | startswith("<!-- flowfig -->")) | .id' | head -1)
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null || echo "flowfig: no comment (read-only token)"
else
  gh api -X POST "repos/$REPO/issues/$PR/comments" -f body="$body" > /dev/null || echo "flowfig: no comment (read-only token)"
fi
exit $status
