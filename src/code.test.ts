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

test('masking a 5000-line file takes under 1 s', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `export const v${i} = "s${i}"; // c${i}`).join('\n');
  const t = performance.now();
  assert.equal(isDefined(at('big.ts', big), 'v4999'), true);
  assert.ok(performance.now() - t < 1000);
});

test('the extent of a Go struct ends at its closing brace, also at the end of the file', () => {
  const go = at('x.go', 'package x\ntype X struct {\n  a int\n}');
  const ex = locate(go, 'X')!;
  assert.match(go.text.slice(ex.start, ex.end), /^type X struct \{\n {2}a int\n\}$/);
});

test('Owner.name needs a member of Owner itself, not a longer type name, a trait or a local', () => {
  const no: [string, string, string][] = [
    ['a.go', 'package s\ntype MyCache struct{}\nfunc (c *MyCache) Get() {}\n', 'Cache.Get'],
    ['a.rs', 'trait Cache { fn put(&self); }\nimpl Cache for Store {\n    fn put(&self) {}\n}\n', 'Cache.put'],
    ['b.rs', 'impl From<Cache> for Store {\n    fn from(c: Cache) -> Self { Store }\n}\n', 'Cache.from'],
    ['a.ts', 'class Store {\n  put() {\n    const get = 1;\n    return { get: 1 };\n  }\n}\n', 'Store.get'],
    ['a.py', 'class Store:\n    def put(self):\n        get = self.cache.get\n        foo(\n            get=1)\n', 'Store.get'],
  ];
  for (const [path, text, symbol] of no) assert.equal(isDefined(at(path, text), symbol), false, `${path} ${symbol}`);
  assert.equal(isDefined(at('g.go', 'package s\ntype Cache[T any] struct{}\nfunc (c *Cache[T]) Get() {}\n'), 'Cache.Get'), true);
  assert.equal(isDefined(at('c.rs', 'impl<T> Cache<T> {\n    fn get(&self) {}\n}\n'), 'Cache.get'), true);
});

test('a name the file only uses is not defined', () => {
  const uses: [string, string][] = [
    ['a.ts', 'export function make(\n  logout: () => void,\n) {}\n'],
    ['b.ts', 'export const r = ok ?\n  logout() : null;\n'],
    ['a.go', 'package a\nfunc f() {\n\tLogout, err = g()\n}\n'],
    ['A.java', 'class A {\n  void f() {\n    do logout(); while (x);\n  }\n}\n'],
  ];
  for (const [path, text] of uses) assert.equal(isDefined(at(path, text), 'logout') || isDefined(at(path, text), 'Logout'), false, path);
});

test('a name the file defines is found: a field, an export, a default export, a BOM or non-ASCII letters', () => {
  const yes: [string, string, string][] = [
    ['Config.java', 'class Config {\n  static final int MAX_RETRIES = 3;\n}\n', 'MAX_RETRIES'],
    ['A.cs', 'class A {\n  public string Login { get; set; }\n}\n', 'Login'],
    ['a.cjs', 'exports.login = function () {};\nmodule.exports.logout = () => {};\n', 'logout'],
    ['b.cjs', 'exports.login = function () {};\n', 'login'],
    ['d.ts', 'export default function () {}\n', 'default'],
    ['bom.py', '﻿def login():\n    pass\n', 'login'],
    ['u.py', 'def données():\n    pass\n', 'données'],
  ];
  for (const [path, text, symbol] of yes) assert.equal(isDefined(at(path, text), symbol), true, `${path} ${symbol}`);
});

test('a local after a method header with where, struct or a parameter named record is not a field', () => {
  const cs = (head: string) => at('A.cs', `class A {\n  ${head} { int logout = 1; }\n}\n`);
  assert.equal(isDefined(cs('void F<T>(T x) where T : class'), 'logout'), false);
  assert.equal(isDefined(cs('void F<T>(T x) where T : struct'), 'logout'), false);
  assert.equal(isDefined(at('A.java', 'class A {\n  void f(Record record) { int logout = 1; }\n}\n'), 'logout'), false);
});

test('Owner.name is defined in an impl for a reference to Owner', () => {
  const rs = at('r.rs', "impl<'a> Iterator for &'a Cache {\n    fn next(&mut self) {}\n}\n");
  assert.equal(isDefined(rs, 'Cache.next'), true);
});

test('a function after a case label is defined', () => {
  assert.equal(isDefined(at('c.ts', 'switch (x) {\n  case 1:\n    function logout() {}\n}\n'), 'logout'), true);
});
