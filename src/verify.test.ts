import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageLine, links, parseSource, verify, verifyReport } from './verify.ts';
import type { FlowProps } from './model.ts';

test('a source link must be path or path#symbol with no space', () => {
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

test('verify lists each well-formed link with the box, edge or hop that owns it', () => {
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

test('a box symbol in a code file must be defined; a mention, a comment or a string is not enough', () => {
  withRepo(
    {
      'src/a.ts': 'export function login() {}\n// logout\nconst s = "reset";\nlogoutAll();\n',
      'docs/sop.md': '# Refund an order\n',
      'notes.txt': 'login',
    },
    (root) => {
      const run = (source: string) => verify(figWith(source), { root }).map((f) => f.message);
      assert.deepEqual(run('src/a.ts#login'), []);
      for (const s of ['logout', 'reset', 'logoutAll'])
        assert.deepEqual(run(`src/a.ts#${s}`), [`box "a" -> src/a.ts#${s}: symbol not defined`]);
      assert.deepEqual(run('docs/sop.md#refund-an-order'), []);
      assert.deepEqual(run('notes.txt#login'), []);
      assert.deepEqual(run('notes.txt#logout'), ['box "a" -> notes.txt#logout: symbol not found']);
    },
  );
});

test('verifyReport counts the boxes with a source and the boxes that pass', () => {
  withRepo({ 'src/a.ts': 'export function a() {}\n', 'img.png': '\x89PNG\r\n\x1a\n\0\0' }, (root) => {
    const fig: FlowProps = {
      layout: {
        children: [
          { id: 'a', label: 'A', source: 'src/a.ts#a' },
          { id: 'b', label: 'B', source: 'src/a.ts#b' },
          { id: 'c', label: 'C', source: 'img.png#x' },
          { id: 'd', label: 'D' },
        ],
      },
      edges: [],
    };
    const r = verifyReport(fig, { root });
    assert.deepEqual(r.coverage, { boxes: 3, boxesDefined: 1 });
    assert.equal(coverageLine('docs/f.svg', r.coverage), 'docs/f.svg: 1 of 3 boxes defined');
  });
});
