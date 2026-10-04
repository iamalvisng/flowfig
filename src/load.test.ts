import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpec, reportLines, sortFindings, specOf, svgWithSpec } from './load.ts';
import { check } from './svg.ts';
import type { FlowProps } from './model.ts';

const props: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'Server', shape: 'store' },
    ],
  },
  edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
  steps: [{ label: 'write', flow: ['w'] }],
};

test('a spec loads from an object, JSON or SVG; a bad input names its path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-'));
  try {
    assert.deepEqual(loadSpec(props), props);
    assert.deepEqual(loadSpec({ props }), props);
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ props }));
    assert.deepEqual(loadSpec(join(dir, 'a.json')), props);
    writeFileSync(join(dir, 'a.svg'), svgWithSpec(props));
    assert.deepEqual(loadSpec(join(dir, 'a.svg')), props);
    assert.throws(() => loadSpec({ edges: [] }), /no figure props/);
    assert.throws(() => loadSpec({ layout: props.layout, edges: 'x' }), /edges must be an array/);
    assert.throws(() => loadSpec({ ...props, steps: [{ label: 's' }] }), /each step needs a flow array/);
    assert.throws(() => loadSpec(join(dir, 'missing.json')), /missing.json: ENOENT/);
    assert.throws(() => specOf('<svg></svg>', 'x.svg'), /x.svg: no figure spec/);
    assert.throws(() => loadSpec(join(dir, 'a.txt')), /a.txt: expected a .json or .svg path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the spec in the SVG survives a ]]> in a label', () => {
  const svg = svgWithSpec({ ...props, steps: [{ label: 'x]]>y', flow: ['w'] }] });
  assert.match(svg, /<metadata id="figure-spec"><!\[CDATA\[/);
  assert.doesNotMatch(svg.slice(svg.indexOf('CDATA[') + 6, svg.indexOf(']]></metadata>')), /\]\]>/);
});

test('the report lists errors first, then the counts and the figure line', () => {
  const bad = { ...props, edges: [{ id: 'w', from: 'a', to: 'zzz', label: 'write' }] };
  const lines = reportLines(bad, sortFindings(check(bad), false));
  assert.match(lines[0], /^error {4}unknown-id/);
  assert.match(lines.at(-2)!, /^1 error, \d+ warnings?$/);
  assert.match(lines.at(-1)!, /^figure: 2 boxes, 0 groups, 1 edge, 1 step, 1 message$/);
  assert.deepEqual(reportLines(props, [], true).slice(-2), [
    '0 errors, 0 warnings',
    'figure: 2 boxes, 0 groups, 1 edge, 1 step, 1 message',
  ]);
  assert.deepEqual(reportLines(props, [], false), ['figure: 2 boxes, 0 groups, 1 edge, 1 step, 1 message']);
  assert.equal(
    sortFindings(check(bad), true).every((f) => f.severity === 'error'),
    true,
  );
});
