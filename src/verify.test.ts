import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headingSlug, links, parseSource, verify } from './verify.ts';
import type { FlowProps } from './model.ts';

test('parseSource reads a path and an optional symbol', () => {
  assert.deepEqual(parseSource('src/a.ts'), { path: 'src/a.ts' });
  assert.deepEqual(parseSource('src/a.ts#f'), { path: 'src/a.ts', symbol: 'f' });
  for (const bad of ['', 'a.ts#', '#f', 'a b.ts', 'a.ts#f#g', 'a.ts#f g']) assert.equal(parseSource(bad), null, bad);
});

const withRepo = (files: Record<string, string>, run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), text);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const figWith = (source?: string): FlowProps => ({
  layout: {
    children: [
      { id: 'a', label: 'A', source },
      { id: 'b', label: 'B' },
    ],
  },
  edges: [{ from: 'a', to: 'b' }],
});
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

test('verify passes a present file and symbol, fails a missing file or symbol', () => {
  withRepo({ 'src/a.ts': 'export function login() {}\nconst $get = 1;' }, (root) => {
    assert.deepEqual(verify(figWith('src/a.ts#login'), { root }), []);
    assert.deepEqual(verify(figWith('src/a.ts'), { root }), []);
    assert.deepEqual(rules(verify(figWith('src/b.ts#login'), { root })), ['missing-file']);
    assert.deepEqual(rules(verify(figWith('src/a.ts#logout'), { root })), ['missing-symbol']);
    assert.deepEqual(rules(verify(figWith('src/a.ts#logi'), { root })), ['missing-symbol']);
    assert.deepEqual(verify(figWith('src/a.ts#$get'), { root }), []);
  });
});

test('a figure with no link is a warning; a path outside the root is a missing file', () => {
  withRepo({ 'src/a.ts': '' }, (root) => {
    assert.deepEqual(rules(verify(figWith(), { root })), ['no-source']);
    assert.deepEqual(rules(verify(figWith('../a.ts'), { root })), ['missing-file']);
    assert.deepEqual(rules(verify(figWith('/etc/hosts'), { root })), ['missing-file']);
  });
});

test('a link to a folder is a missing file, not a crash', () => {
  withRepo({ 'src/a.ts': '', '..x': '' }, (root) => {
    assert.deepEqual(rules(verify(figWith('src'), { root })), ['missing-file']);
    assert.deepEqual(verify(figWith('..x'), { root }), []);
  });
});

test('links lists every well-formed link with its owner', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'A', source: 'x.ts#f' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'e', from: 'a', to: 'b', source: 'y.ts' }],
    steps: [
      {
        label: 's',
        flow: [{ edges: { edge: 'e', source: 'z.ts#g' } }, { edges: { edge: 'e', source: 'bad#' } }],
      },
    ],
  };
  assert.deepEqual(links(fig), [
    { owner: 'box "a"', source: 'x.ts#f', path: 'x.ts', symbol: 'f' },
    { owner: 'edge "e"', source: 'y.ts', path: 'y.ts' },
    { owner: 'hop on "e"', source: 'z.ts#g', path: 'z.ts', symbol: 'g' },
  ]);
});

test('a Markdown heading is a valid symbol; a code file gets the word search only', () => {
  const files = { 'docs/sop.md': '## Step 3: Approve the refund\n### Notes\n', 'src/a.ts': '// ## Step 3\n' };
  withRepo(files, (root) => {
    const run = (s: string) => rules(verify(figWith(s), { root }));
    assert.deepEqual(run('docs/sop.md#step-3-approve-the-refund'), []);
    assert.deepEqual(run('docs/sop.md#notes'), []);
    assert.deepEqual(run('docs/sop.md#step-4'), ['missing-symbol']);
    assert.deepEqual(run('src/a.ts#step-3'), ['missing-symbol']);
  });
});

test('headingSlug follows the GitHub anchor rule', () => {
  assert.equal(headingSlug('Step 3: Approve the refund'), 'step-3-approve-the-refund');
  assert.equal(headingSlug('Notes'), 'notes');
  assert.equal(headingSlug('A/B test (v2)'), 'ab-test-v2');
});

test('parseSource reads a Markdown path with an anchor', () => {
  assert.deepEqual(parseSource('docs/a.md#step-3'), { path: 'docs/a.md', symbol: 'step-3' });
});
