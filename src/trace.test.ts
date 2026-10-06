import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Read } from './code.ts';
import { trace } from './trace.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'cli.js');
const ROOT = resolve('/r');
const repo = (files: Record<string, string>): Read =>
  Object.assign((full: string) => files[relative(ROOT, full).replace(/\\/g, '/')] ?? null, { files: () => Object.keys(files) });
const run = (files: Record<string, string>, start: string, opts: { depth?: number; max?: number } = {}) =>
  trace(start, { root: ROOT, read: repo(files), ...opts });

test('trace prints an edge for an imported callee with the file and line of the call', () => {
  const files = {
    'src/password.ts': 'export function verifyPassword() {}\n',
    'src/login.ts':
      "import { verifyPassword } from './password.ts';\n\nexport function login() {\n  const ok = verifyPassword();\n  return ok;\n}\n",
  };
  assert.deepEqual(run(files, 'src/login.ts#login').edges, [
    { from: 'src/login.ts#login', to: 'src/password.ts#verifyPassword', at: 'src/login.ts:4' },
  ]);
});

test('a call of a parameter is unsure, and a handler named by a string is open', () => {
  const files = {
    'src/routes.ts': "export function routes(router, next) {\n  router.get('/archive', 'documents.archive');\n  next();\n}\n",
  };
  const r = run(files, 'src/routes.ts#routes');
  assert.deepEqual(r.unsure, [{ at: 'src/routes.ts:3', reason: 'parameter call: next()' }]);
  assert.deepEqual(r.open, [{ at: 'src/routes.ts:2', reason: 'string route "documents.archive"' }]);
});

test('the depth limit and the edge limit each give a stop line', () => {
  const files = {
    'src/a.ts': "import { b } from './b.ts';\nimport { c } from './c.ts';\nexport function a() { b(); c(); }\n",
    'src/b.ts': "import { d } from './d.ts';\nexport function b() { d(); }\n",
    'src/c.ts': 'export function c() {}\n',
    'src/d.ts': 'export function d() {}\n',
  };
  assert.deepEqual(run(files, 'src/a.ts#a', { depth: 1 }).stops, [{ reason: 'depth', count: 2 }]);
  const capped = run(files, 'src/a.ts#a', { max: 1 });
  assert.equal(capped.edges.length, 1);
  assert.deepEqual(capped.stops, [{ reason: 'max', count: 1 }]);
});

test('a call cycle visits each symbol once and the trace ends', () => {
  const files = {
    'src/a.ts': "import { b } from './b.ts';\nexport function a() { b(); }\n",
    'src/b.ts': "import { a } from './a.ts';\nexport function b() { a(); }\n",
  };
  const r = run(files, 'src/a.ts#a', { depth: 10 });
  assert.deepEqual(
    r.edges.map((e) => `${e.from} -> ${e.to}`),
    ['src/a.ts#a -> src/b.ts#b', 'src/b.ts#b -> src/a.ts#a'],
  );
  assert.deepEqual(r.stops, []);
});

test('a call into a package gives no line and counts as outside the repo', () => {
  const files = { 'src/a.ts': "import axios from 'axios';\nexport function a() { axios.get('/x'); axios('/y'); }\n" };
  const r = run(files, 'src/a.ts#a');
  assert.deepEqual([r.edges, r.unsure, r.open, r.outside], [[], [], [], 2]);
});

test('flowfig trace exits 1 when the start symbol is not defined', () => {
  const root = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    writeFileSync(join(root, 'a.ts'), 'export function login() {}\n');
    const r = spawnSync('node', [cli, 'trace', 'a.ts#logout', '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /a\.ts#logout: symbol not defined/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('flowfig trace prints the edge lines first and the summary line last', () => {
  const root = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    writeFileSync(join(root, 'password.ts'), 'export function verifyPassword() {}\n');
    writeFileSync(
      join(root, 'login.ts'),
      "import { verifyPassword } from './password.ts';\nexport function login() { verifyPassword(); }\n",
    );
    const r = spawnSync('node', [cli, 'trace', 'login.ts#login', '--root', root], { encoding: 'utf8' });
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(r.status, 0);
    assert.equal(lines[0], 'login.ts#login -> password.ts#verifyPassword   login.ts:2');
    assert.match(lines.at(-1)!, /^summary: 2 symbols, 1 found, 0 unsure, 0 open, 0 calls outside the repo, \d+\.\d s$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an arrow parameter named like a local of another function is no edge, and a top-level call is', () => {
  const files = {
    'src/m.ts':
      'export function toBeat(hops) {\n  return hops.map((h) => pick(h));\n}\nexport function pick(x) {\n  return x;\n}\nfunction other() {\n  const h = 1;\n  return h;\n}\nexport function run() {\n  return pick(1);\n}\n',
  };
  assert.deepEqual(run(files, 'src/m.ts#toBeat').edges, [{ from: 'src/m.ts#toBeat', to: 'src/m.ts#pick', at: 'src/m.ts:2' }]);
  assert.deepEqual(run(files, 'src/m.ts#run').edges, [{ from: 'src/m.ts#run', to: 'src/m.ts#pick', at: 'src/m.ts:12' }]);
});
