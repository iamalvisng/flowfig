#!/usr/bin/env bash
# Install the packed tarball into a clean project and use it the way a user does: the two entry
# points and the bin. The tests run from src/, so only this catches a broken dist/ or package.json.
# REACT=18 checks the low end of the peer range.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

node -e "if (Object.keys(require('$repo/package.json').dependencies ?? {}).length) process.exit(1)" || { echo 'package.json has a dependency'; exit 1; }

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

spec='{"props":{"layout":{"children":[{"id":"a","label":"A"}]},"edges":[],"steps":[]}}'
echo "$spec" | npx --no-install flowfig - out.svg
[ "$(npx --no-install flowfig --spec out.svg)" = "$spec" ] || { echo 'bin: spec did not round-trip'; exit 1; }
npx --no-install flowfig check out.svg >/dev/null || { echo 'bin: check failed on a good figure'; exit 1; }
[ -n "$(npx --no-install flowfig docs)" ] || { echo 'bin: docs printed nothing'; exit 1; }
npx --no-install flowfig init -y --agents agents >/dev/null
grep -q '<!-- flowfig:start -->' AGENTS.md || { echo 'bin: init wrote no section'; exit 1; }
echo "pack smoke test: ok (react $(node -p "require('react/package.json').version"))"
