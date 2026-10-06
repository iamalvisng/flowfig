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

const targets = (files: Record<string, string>, start: string) => run(files, start, { depth: 1 }).edges.map((e) => e.to);

test('a bare call to an inherited method goes to the base class, not to a nested class method of the same name', () => {
  const java = {
    'src/app/Base.java': 'package app;\n\npublic class Base {\n    int log() {\n        return 2;\n    }\n}\n',
    'src/app/A.java':
      'package app;\n\npublic class A extends Base {\n    public int run() {\n        return log();\n    }\n\n    static class B {\n        int log() {\n            return 1;\n        }\n    }\n}\n',
  };
  assert.deepEqual(targets(java, 'src/app/A.java#A.run'), ['src/app/Base.java#Base.log']);
  const cs = {
    'Base.cs': 'namespace App;\n\npublic class Base\n{\n    protected int Log()\n    {\n        return 2;\n    }\n}\n',
    'A.cs':
      'namespace App;\n\npublic class A : Base\n{\n    public int Run()\n    {\n        return Log();\n    }\n\n    class B\n    {\n        int Log()\n        {\n            return 1;\n        }\n    }\n}\n',
  };
  assert.deepEqual(targets(cs, 'A.cs#A.Run'), ['Base.cs#Base.Log']);
});

test('a bare Go or Rust call goes to a free function, not to a method of the same name', () => {
  const files = {
    'go.mod': 'module example.com/t3\n\ngo 1.21\n',
    'other.go': 'package main\n\nfunc helper() int {\n\treturn 2\n}\n',
    'm.go':
      'package main\n\ntype B struct{}\n\nfunc (b *B) helper() int {\n\treturn 1\n}\n\ntype A struct{}\n\nfunc (a *A) Run() int {\n\treturn helper()\n}\n',
  };
  assert.deepEqual(targets(files, 'm.go#A.Run'), ['other.go#helper']);
  const rs = {
    'Cargo.toml': '[package]\nname = "t7"\nversion = "0.1.0"\n',
    'src/lib.rs':
      'pub struct X;\n\nimpl X {\n    fn handle(&self) -> i32 {\n        1\n    }\n}\n\npub fn run() -> i32 {\n    handle()\n}\n',
  };
  assert.deepEqual(targets(rs, 'src/lib.rs#run'), []);
});

test('a call of a lambda, Go function literal or $-named arrow parameter gives no edge', () => {
  const files = {
    'm.py': 'def handle(x):\n    return x\n\n\ndef lam(xs):\n    return list(map(lambda handle: handle(1), xs))\n',
    'go.mod': 'module example.com/t3\n\ngo 1.21\n',
    'm.go':
      'package main\n\nfunc handle(x int) int {\n\treturn x\n}\n\nfunc Each(xs []int) {\n\tapply(xs, func(handle func(int) int) {\n\t\thandle(1)\n\t})\n}\n\nfunc apply(xs []int, f func(func(int) int)) {}\n',
    'm.ts': 'export function $h(x) {\n  return x;\n}\nexport function dollar(xs) {\n  return xs.map(($h) => $h(1));\n}\n',
  };
  assert.deepEqual(targets(files, 'm.py#lam'), []);
  assert.deepEqual(targets(files, 'm.go#Each'), ['m.go#apply']);
  assert.deepEqual(targets(files, 'm.ts#dollar'), []);
});

test('a call of a nested function gives no edge to a top-level function of the same name', () => {
  const files = {
    'm.ts':
      'export function render(x) {\n  return x;\n}\nexport function nested() {\n  function render(y) { return y; }\n  return render(2);\n}\n',
    'Cargo.toml': '[package]\nname = "t5"\nversion = "0.1.0"\n',
    'src/lib.rs':
      'pub fn handle(x: i32) -> i32 {\n    x\n}\n\npub fn outer() -> i32 {\n    fn handle(y: i32) -> i32 {\n        y + 1\n    }\n    handle(2)\n}\n',
  };
  assert.deepEqual(targets(files, 'm.ts#nested'), []);
  assert.deepEqual(targets(files, 'src/lib.rs#outer'), []);
});
