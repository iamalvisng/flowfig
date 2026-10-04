import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFile, isDefined, locate } from './code.ts';

const at = (path: string, text: string) => codeFile('/r', path, () => text)!;

test('a box symbol counts only where the file defines it, in each language', () => {
  const cases: [string, string, string, string][] = [
    ['a.ts', 'export async function login() {}\n// logout()\nconst x = "logout";', 'login', 'logout'],
    ['a.py', 'def login():\n    pass\n# logout\nx = "logout"\n', 'login', 'logout'],
    ['a.go', 'package a\nfunc Login() {}\n// Logout()\nvar s = "Logout"\n', 'Login', 'Logout'],
    ['A.java', 'class A {\n  void login() {}\n  // logout()\n  String s = "logout";\n}\n', 'login', 'logout'],
    ['A.cs', 'class A {\n  void Login() {}\n  // Logout()\n  string s = "Logout";\n}\n', 'Login', 'Logout'],
    ['a.rs', 'fn login() {}\n// logout()\nconst S: &str = "logout";\n', 'login', 'logout'],
  ];
  for (const [path, text, defined, mentioned] of cases) {
    assert.equal(isDefined(at(path, text), defined), true, `${path} ${defined}`);
    assert.equal(isDefined(at(path, text), mentioned), false, `${path} ${mentioned}`);
  }
});

test('Owner.name is defined only inside Owner', () => {
  const ts = at('s.ts', 'class Cache {\n  get(k: string) {}\n}\nclass Store {\n  put() {}\n}\n');
  assert.equal(isDefined(ts, 'Cache.get'), true);
  assert.equal(isDefined(ts, 'Store.get'), false);
  const go = at('s.go', 'package s\ntype Cache struct{}\nfunc (c *Cache) Get() {}\nfunc (s Store) Put() {}\n');
  assert.equal(isDefined(go, 'Cache.Get'), true);
  assert.equal(isDefined(go, 'Store.Get'), false);
  const py = at('s.py', 'class Cache:\n    def get(self):\n        pass\n\nclass Store:\n    def put(self):\n        pass\n');
  assert.equal(isDefined(py, 'Cache.get'), true);
  assert.equal(isDefined(py, 'Store.get'), false);
  const rs = at('s.rs', 'struct Cache;\nimpl Cache {\n    fn get(&self) {}\n}\nimpl Store for Cache {\n    fn put(&self) {}\n}\n');
  assert.equal(isDefined(rs, 'Cache.get'), true);
  assert.equal(isDefined(rs, 'Cache.put'), true);
});

test('the extent of a definition ends at its own closing brace or dedent', () => {
  const ts = at('e.ts', 'function a() {\n  const s = "}";\n  b();\n}\nfunction c() {}\n');
  const ex = locate(ts, 'a')!;
  assert.match(ts.text.slice(ex.start, ex.end), /b\(\);\n\}$/);
  const py = at('e.py', 'def a():\n    b()\n\n    c()\ndef d():\n    pass\n');
  const ep = locate(py, 'a')!;
  assert.match(py.text.slice(ep.start, ep.end), /c\(\)/);
  assert.doesNotMatch(py.text.slice(ep.start, ep.end), /def d/);
});

test('a broken file or CRLF line ends give a result, not a crash', () => {
  assert.equal(isDefined(at('b.ts', 'function a() {\r\n  const s = "open\r\n'), 'a'), true);
  assert.equal(isDefined(at('b.py', 'def a():\r\n    x = """open\r\n'), 'a'), true);
  assert.equal(
    codeFile('/r', 'x.md', () => '# A'),
    null,
  );
});

test('masking a 5000-line file takes under 200 ms', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `export const v${i} = "s${i}"; // c${i}`).join('\n');
  const t = performance.now();
  assert.equal(isDefined(at('big.ts', big), 'v4999'), true);
  assert.ok(performance.now() - t < 200);
});

test('the extent of a Go struct ends at its closing brace, also at the end of the file', () => {
  const go = at('x.go', 'package x\ntype X struct {\n  a int\n}');
  const ex = locate(go, 'X')!;
  assert.match(go.text.slice(ex.start, ex.end), /^type X struct \{\n {2}a int\n\}$/);
});
