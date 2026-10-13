#!/usr/bin/env bash
# Only this script tests the packed package. The unit tests import from src/.
# REACT=18 checks the low end of the peer range.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

node -e "if (['dependencies', 'optionalDependencies'].some((k) => Object.keys(require('$repo/package.json')[k] ?? {}).length)) process.exit(1)" || { echo 'package.json has a dependency'; exit 1; }

tarball=$(cd "$repo" && npm pack --silent --pack-destination "$dir" | tail -n 1)
cd "$dir"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "./$tarball" "react@${REACT:-latest}" "react-dom@${REACT:-latest}"

node --input-type=module -e "
import { toSvg } from 'flowfig/svg';
import { Flow } from 'flowfig';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const props = { layout: { children: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  edges: [{ id: 'e', from: 'a', to: 'b' }], steps: [{ label: 's', flow: [{ edges: 'e' }] }] };
if (!toSvg(props).includes('<svg')) throw new Error('toSvg: no <svg>');
if (!renderToString(createElement(Flow, props)).length) throw new Error('Flow: empty render');
"

node --input-type=module -e "await import('flowfig/element')"
for f in element.js element-*.js; do
  for ref in $(grep -oE "(from|import\()\s*['\"]\.\.?/[^'\"]+['\"]" "node_modules/flowfig/dist/$f" | grep -oE "[^/'\"]+\.js"); do
    case "$ref" in element.js | element-*.js) [ -f "node_modules/flowfig/dist/$ref" ] || { echo "$f imports $ref, which is missing"; exit 1; } ;; *) echo "$f imports $ref, not an element file"; exit 1 ;; esac
  done
done
[ -f node_modules/flowfig/dist/element-world.js ] || { echo 'element-world.js is missing'; exit 1; }
[ -f node_modules/flowfig/dist/element.d.ts ] || { echo 'element.d.ts is missing'; exit 1; }

spec='{"props":{"layout":{"children":[{"id":"a","label":"A"}]},"edges":[],"steps":[]}}'
echo "$spec" | npx --no-install flowfig - out.svg
[ "$(npx --no-install flowfig --spec out.svg)" = "$spec" ] || { echo 'bin: spec did not round-trip'; exit 1; }
npx --no-install flowfig check out.svg >/dev/null || { echo 'bin: check failed on a good figure'; exit 1; }
[ -n "$(npx --no-install flowfig docs)" ] || { echo 'bin: docs printed nothing'; exit 1; }
npx --no-install flowfig init -y --agents agents >/dev/null
grep -q '<!-- flowfig:start -->' AGENTS.md || { echo 'bin: init wrote no section'; exit 1; }
echo "pack smoke test: ok (react $(node -p "require('react/package.json').version"))"
