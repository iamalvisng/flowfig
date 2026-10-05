import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relative, resolve } from 'node:path';
import type { Read } from './code.ts';
import { edgeResult } from './edges.ts';

const ROOT = resolve('/r');
const repo = (files: Record<string, string>): Read =>
  Object.assign((full: string) => files[relative(ROOT, full).replace(/\\/g, '/')] ?? null, { files: () => Object.keys(files) });
const run = (files: Record<string, string>, caller: string, callee?: string, via?: string) =>
  edgeResult(ROOT, caller, callee, via, repo(files)).result;

test('an edge is found when the caller calls the callee through an import, an alias or a re-export', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\n',
    'src/index.ts': "export { verify } from './auth.ts';\n",
    'src/login.ts': "import { verify as check } from './auth.ts';\nexport function login() { check(); }\n",
    'src/signup.ts': "import { verify } from './index.ts';\nexport function signup() { verify(); }\n",
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } } }',
    'src/reset.ts': "import { verify } from '@app/auth';\nexport function reset() { verify(); }\n",
  };
  assert.equal(run(files, 'src/login.ts#login', 'src/auth.ts#verify'), 'found');
  assert.equal(run(files, 'src/signup.ts#signup', 'src/auth.ts#verify'), 'found');
  assert.equal(run(files, 'src/reset.ts#reset', 'src/auth.ts#verify'), 'found');
});

test('an edge is found through the Go module path and a Python package', () => {
  const files = {
    'go.mod': 'module example.com/app\n',
    'store/store.go': 'package store\nfunc Save() {}\n',
    'api/api.go': 'package api\nimport "example.com/app/store"\nfunc Create() { store.Save() }\n',
    'app/__init__.py': '',
    'app/db.py': 'def save():\n    pass\n',
    'app/api.py': 'from app.db import save\n\ndef create():\n    save()\n',
  };
  assert.equal(run(files, 'api/api.go#Create', 'store/store.go#Save'), 'found');
  assert.equal(run(files, 'app/api.py#create', 'app/db.py#save'), 'found');
});

test('an edge is not found when the call is in a comment, a string, another function or a parameter name', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\n',
    'src/a.ts':
      "import { verify } from './auth.ts';\n" +
      'export function inComment() { /* verify() */ }\n' +
      'export function inString() { log("verify()"); }\n' +
      'export function other() { verify(); }\n' +
      'export function param(verify: boolean) { return verify; }\n',
  };
  for (const f of ['inComment', 'inString', 'param']) assert.equal(run(files, `src/a.ts#${f}`, 'src/auth.ts#verify'), 'not-found', f);
  assert.equal(run(files, 'src/a.ts#other', 'src/auth.ts#verify'), 'found');
});

test('via: the token must be in the caller and in the callee', () => {
  const files = {
    'src/send.ts': "export function send() { queue.add('order-paid', {}); }\n",
    'src/work.ts': "export function work() { queue.process('order-paid', run); }\n",
    'src/other.ts': "export function other() { queue.process('refund', run); }\n",
  };
  assert.equal(run(files, 'src/send.ts#send', 'src/work.ts#work', 'order-paid'), 'found');
  assert.equal(run(files, 'src/send.ts#send', 'src/other.ts#other', 'order-paid'), 'not-found');
  assert.equal(run(files, 'src/send.ts#send', undefined, 'order-paid'), 'found');
});

test('an edge with no code to check is not checked', () => {
  const files = { 'a.txt': 'x', 'src/a.ts': 'export function a() {}\n' };
  assert.equal(run(files, 'a.txt', 'src/a.ts#a'), 'not-checked');
  assert.equal(run(files, 'src/a.ts#a', undefined), 'not-checked');
});

test('a CRLF file and a callee import written with ./ give the same result as LF', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\r\n',
    'src/login.ts': "import { verify } from './auth';\r\nexport function login() {\r\n  verify();\r\n}\r\n",
  };
  assert.equal(run(files, 'src/login.ts#login', 'src/auth.ts#verify'), 'found');
});

test('a callee file with no symbol is found when the caller uses a name from it', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\n',
    'src/login.ts': "import { verify } from './auth.ts';\nexport function login() { verify(); }\n",
    'src/other.ts': 'export function other() { verify(); }\n',
    'go.mod': 'module example.com/app\n',
    'api/a.go': 'package api\nfunc Create() { Save() }\n',
    'api/b.go': 'package api\nfunc Save() {}\n',
  };
  assert.equal(run(files, 'src/login.ts#login', 'src/auth.ts'), 'found');
  assert.equal(run(files, 'src/other.ts#other', 'src/auth.ts'), 'not-found');
  assert.equal(run(files, 'api/a.go#Create', 'api/b.go'), 'found');
});

test('the same method name on a receiver of another known type is not found; an unknown type is unsure', () => {
  const files = {
    'src/cache.ts': 'export class Cache {\n  delete(k: string) {}\n  get() {}\n}\n',
    'src/log.ts': 'export class Log {\n  delete(k: string) {}\n  get() {}\n}\n',
    'src/a.ts':
      "import { Cache } from './cache.ts';\nimport { Log } from './log.ts';\n" +
      'export class A {\n  constructor(private cache: Cache, private log: Log) {}\n' +
      '  viaCache() { this.cache.delete("k"); }\n  viaLog() { this.log.delete("k"); }\n' +
      '  viaAny(x) { x.delete("k"); }\n  get() { this.log.get(); }\n}\n',
  };
  assert.equal(run(files, 'src/a.ts#A.viaCache', 'src/cache.ts#Cache.delete'), 'found');
  assert.equal(run(files, 'src/a.ts#A.viaLog', 'src/cache.ts#Cache.delete'), 'not-found');
  assert.equal(run(files, 'src/a.ts#A.viaAny', 'src/cache.ts#Cache.delete'), 'unsure');
  assert.equal(run(files, 'src/a.ts#A.get', 'src/cache.ts#Cache.get'), 'not-found');
});

test('a call on an interface receiver is found for a type that implements the interface', () => {
  const files = {
    'go.mod': 'module example.com/app\n',
    'store/driver.go': 'package store\ntype Driver interface {\n\tCreateMemo() error\n}\n',
    'store/sqlite.go': 'package store\ntype DB struct{}\nfunc (d *DB) CreateMemo() error { return nil }\n',
    'store/store.go':
      'package store\ntype Store struct {\n\tdriver Driver\n}\nfunc (s *Store) CreateMemo() error { return s.driver.CreateMemo() }\n',
    'src/port.ts': 'export interface Port {\n  send(): void;\n}\n',
    'src/mail.ts': "import { Port } from './port.ts';\nexport class Mail implements Port {\n  send() {}\n}\n",
    'src/use.ts': "import { Port } from './port.ts';\nexport function notify(p: Port) { p.send(); }\n",
  };
  assert.equal(run(files, 'store/store.go#Store.CreateMemo', 'store/sqlite.go#DB.CreateMemo'), 'found');
  assert.equal(run(files, 'src/use.ts#notify', 'src/mail.ts#Mail.send'), 'found');
});

test('the same type name in two modules: only the imported declaration is found', () => {
  const files = {
    'a/service.py': 'class ReleaseService:\n    def rollback(self):\n        pass\n',
    'b/service.py': 'class ReleaseService:\n    def rollback(self):\n        pass\n',
    'a/__init__.py': '',
    'b/__init__.py': '',
    'a/api.py': 'from a.service import ReleaseService\n\ndef undo(svc: ReleaseService):\n    svc.rollback()\n',
  };
  assert.equal(run(files, 'a/api.py#undo', 'a/service.py#ReleaseService.rollback'), 'found');
  assert.equal(run(files, 'a/api.py#undo', 'b/service.py#ReleaseService.rollback'), 'not-found');
});

test('a method call on a type from outside the repo is unsure, not "not found"', () => {
  const files = {
    'go.mod': 'module example.com/app\n',
    'cache/cache.go':
      'package cache\nimport "sync"\ntype Cache struct {\n\tdata sync.Map\n}\n' +
      'func (c *Cache) Delete(k string) {}\nfunc (c *Cache) Get(k string) { c.data.Delete(k) }\n',
  };
  assert.equal(run(files, 'cache/cache.go#Cache.Get', 'cache/cache.go#Cache.Delete'), 'unsure');
});

test('a receiver in a broken file is unsure, not a crash', () => {
  const files = { 'src/c.ts': 'export class C {\n  run() {}\n}\n', 'src/b.ts': 'export function b(x) { x.run(' };
  assert.equal(run(files, 'src/b.ts#b', 'src/c.ts#C.run'), 'unsure');
});

test('a receiver typed by a call result is found when the return type is declared', () => {
  const files = {
    'src/buyer.ts': 'export class Buyer {\n  pay() {}\n}\n',
    'src/repo.ts': "import { Buyer } from './buyer.ts';\nexport class Repo {\n  find(id: string): Promise<Buyer> { return null!; }\n}\n",
    'src/order.ts':
      "import { Repo } from './repo.ts';\nexport class Orders {\n  constructor(private repo: Repo) {}\n" +
      '  async place() {\n    const buyer = await this.repo.find("1");\n    buyer.pay();\n  }\n}\n',
    'go.mod': 'module example.com/app\n',
    'user/user.go': 'package user\ntype User struct{}\nfunc (u *User) Save() {}\nfunc Load() (*User, error) { return nil, nil }\n',
    'api/api.go': 'package api\nimport "example.com/app/user"\nfunc Create() {\n\tu, _ := user.Load()\n\tu.Save()\n}\n',
    'app/__init__.py': '',
    'app/models.py': 'class Alert:\n    def notify(self):\n        pass\n\ndef load() -> Alert:\n    return Alert()\n',
    'app/job.py': 'from app.models import load\n\ndef run():\n    a = load()\n    a.notify()\n',
  };
  assert.equal(run(files, 'src/order.ts#Orders.place', 'src/buyer.ts#Buyer.pay'), 'found');
  assert.equal(run(files, 'api/api.go#Create', 'user/user.go#User.Save'), 'found');
  assert.equal(run(files, 'app/job.py#run', 'app/models.py#Alert.notify'), 'found');
});

test('a Go interface and a struct with the same name in two packages: a call on the interface is found', () => {
  const files = {
    'go.mod': 'module example.com/app\n',
    'blob/blob.go': 'package blob\ntype Driver interface {\n\tPut(key string) error\n}\n',
    'blob/s3/s3.go': 'package s3\ntype Driver struct{}\nfunc (c *Driver) Put(key string) error { return nil }\n',
    'api/save.go': 'package api\nimport "example.com/app/blob"\nfunc save(d blob.Driver) error {\n\treturn d.Put("k")\n}\n',
  };
  assert.equal(run(files, 'api/save.go#save', 'blob/s3/s3.go#Driver.Put'), 'found');
});

test('one name bound to two types in one function: a call on it is unsure, not "not found"', () => {
  const files = {
    'src/base.ts': 'export class Node { toText() {} }\nexport class Mark { toText() {} }\n',
    'src/bold.ts': "import { Mark } from './base.ts';\nexport class Bold extends Mark {\n  toText() {}\n}\n",
    'src/run.ts':
      "import { Node, Mark } from './base.ts';\nexport function run(xs: Node[], ys: Mark[]) {\n  xs.map((e: Node) => e.toText());\n  ys.map((e: Mark) => e.toText());\n}\n",
  };
  assert.equal(run(files, 'src/run.ts#run', 'src/bold.ts#Bold.toText'), 'unsure');
});

test('an import that does not resolve is unsure; a workspace path, a go.mod, a src layout, a tsconfig alias and a re-export chain resolve', () => {
  const files = {
    'packages/auth/src/index.ts': 'export function verify() {}\n',
    'apps/web/login.ts': "import { verify } from '@acme/auth';\nexport function login() { verify(); }\n",
    'backend/go.mod': 'module example.com/app\n',
    'backend/store/store.go': 'package store\nfunc Save() {}\n',
    'backend/api/api.go': 'package api\nimport "example.com/app/store"\nfunc Create() { store.Save() }\n',
    'src/app/__init__.py': '',
    'src/app/db.py': 'def save():\n    pass\n',
    'src/app/api.py': 'from app.db import save\n\ndef create():\n    save()\n',
    'tsconfig.json': '{ "extends": "./tsconfig.base.json", "compilerOptions": { "paths": { "@auth": ["src/auth.ts"] } } }',
    'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }',
    'src/auth.ts': 'export function verify() {}\n',
    'src/a.ts': "import { verify } from '@auth';\nexport function a() { verify(); }\n",
    'src/b.ts': "import { verify } from '@app/auth';\nexport function b() { verify(); }\n",
    'src/barrel/index.ts': "export * from '../auth.ts';\n",
    'src/index.ts': "export * from './barrel/index.ts';\n",
    'src/c.ts': "import { verify } from './index.ts';\nexport function c() { verify(); }\n",
    'src/d.ts': "export async function d() { const { verify } = await import('./auth.ts'); verify(); }\n",
    'java/a/Auth.java': 'package a;\npublic class Auth {\n  public static void verify() {}\n}\n',
    'java/b/Login.java': 'package b;\nimport static a.Auth.verify;\npublic class Login {\n  void login() { verify(); }\n}\n',
  };
  assert.equal(run(files, 'apps/web/login.ts#login', 'packages/auth/src/index.ts#verify'), 'unsure');
  assert.equal(run(files, 'apps/web/login.ts#login', 'packages/auth/src/index.ts'), 'unsure');
  assert.equal(run(files, 'backend/api/api.go#Create', 'backend/store/store.go#Save'), 'found');
  assert.equal(run(files, 'src/app/api.py#create', 'src/app/db.py#save'), 'found');
  for (const f of ['a', 'b', 'c', 'd']) assert.equal(run(files, `src/${f}.ts#${f}`, 'src/auth.ts#verify'), 'found', f);
  assert.equal(run(files, 'java/b/Login.java#Login.login', 'java/a/Auth.java#Auth.verify'), 'found');
});

test('an import leads to the callee only through the callee file or a re-export of the same name', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\nexport function hash() {}\n',
    'src/util.ts': "import { hash } from './auth.ts';\nexport function verify() { hash(); }\nexport function wrap() {}\n",
    'src/a.ts': "import { verify } from './util.ts';\nexport function a() { verify(); }\n",
    'src/b.ts': "import * as util from './util.ts';\nexport function b() { util.verify(); }\n",
    'src/c.ts': "import { wrap } from './util.ts';\nexport function c() { wrap(); }\n",
    'app/__init__.py': '',
    'app/db/__init__.py': 'from .core import save\n',
    'app/db/core.py': 'def save():\n    pass\n',
    'app/api.py': 'from app.db import save\n\ndef create():\n    save()\n',
  };
  for (const f of ['a', 'b']) assert.equal(run(files, `src/${f}.ts#${f}`, 'src/auth.ts#verify'), 'not-found', f);
  assert.equal(run(files, 'src/c.ts#c', 'src/auth.ts'), 'not-found');
  assert.equal(run(files, 'app/api.py#create', 'app/db/core.py#save'), 'found');
});

test('an alias counts only when its import leads to the callee file', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\n',
    'src/legacy.ts': 'export function verify() {}\n',
    'src/login.ts': "import { verify as check } from './legacy.ts';\nexport function login() { check(); }\n",
  };
  assert.equal(run(files, 'src/login.ts#login', 'src/auth.ts#verify'), 'not-found');
});

test('a receiver of a top type is unsure: any, unknown, object, Go error, Java Object', () => {
  const files = {
    'src/cache.ts': 'export class Cache {\n  delete(k: string) {}\n}\n',
    'src/any.ts': "export function f(c: any) { c.delete('k'); }\n",
    'src/unknown.ts': "export function f(c: unknown) { c.delete('k'); }\n",
    'src/object.ts': "export function f(c: object) { c.delete('k'); }\n",
    'go.mod': 'module example.com/app\n',
    'e/e.go': 'package e\ntype MyErr struct{}\nfunc (m *MyErr) Error() string { return "" }\n',
    'e/use.go': 'package e\nfunc Show(err error) string {\n\treturn err.Error()\n}\n',
    'j/Money.java': 'public class Money {\n  public String toString() { return ""; }\n}\n',
    'j/A.java': 'public class A {\n  String f(Object o) { return o.toString(); }\n}\n',
  };
  for (const t of ['any', 'unknown', 'object']) assert.equal(run(files, `src/${t}.ts#f`, 'src/cache.ts#Cache.delete'), 'unsure', t);
  assert.equal(run(files, 'e/use.go#Show', 'e/e.go#MyErr.Error'), 'unsure');
  assert.equal(run(files, 'j/A.java#A.f', 'j/Money.java#Money.toString'), 'unsure');
});

test('a receiver type the rules cannot read is unsure; a generic bound and a Go embedded struct are read', () => {
  const files = {
    'src/cache.ts': 'export class Cache {\n  delete(k: string) {}\n}\n',
    'src/bound.ts': "import { Cache } from './cache.ts';\nexport function f<T extends Cache>(c: T) { c.delete('k'); }\n",
    'src/mail.ts': 'export class Mail {\n  send() {}\n}\n',
    'src/shape.ts': 'type Port = { send(): void };\nexport function notify(p: Port) { p.send(); }\n',
    'app/__init__.py': '',
    'app/port.py': 'from typing import Protocol\n\nclass Port(Protocol):\n    def send(self): ...\n',
    'app/mail.py': 'class Mail:\n    def send(self):\n        pass\n',
    'app/use.py': 'from app.port import Port\n\ndef notify(p: Port):\n    p.send()\n',
    'go.mod': 'module example.com/app\n',
    'store/driver.go': 'package store\ntype Driver interface {\n\tPut() error\n\tClose() error\n}\n',
    'store/base.go': 'package store\ntype Base struct{}\nfunc (b *Base) Close() error { return nil }\n',
    'store/s3.go': 'package store\ntype S3 struct {\n\tBase\n}\nfunc (s *S3) Put() error { return nil }\n',
    'store/use.go': 'package store\nfunc Save(d Driver) error {\n\treturn d.Put()\n}\n',
    'j/MyHandler.java': 'import org.lib.AbstractHandler;\npublic class MyHandler extends AbstractHandler {\n  public void handle() {}\n}\n',
    'j/A.java': 'import org.lib.Handler;\npublic class A {\n  void f(Handler h) { h.handle(); }\n}\n',
    'r/a.rs': 'use std::io::Write;\nstruct Out;\nimpl Out {\n    fn flush(&mut self) {}\n}\nfn f(w: &mut dyn Write) {\n    w.flush();\n}\n',
  };
  assert.equal(run(files, 'src/bound.ts#f', 'src/cache.ts#Cache.delete'), 'found');
  assert.equal(run(files, 'store/use.go#Save', 'store/s3.go#S3.Put'), 'found');
  assert.equal(run(files, 'src/shape.ts#notify', 'src/mail.ts#Mail.send'), 'unsure');
  assert.equal(run(files, 'app/use.py#notify', 'app/mail.py#Mail.send'), 'unsure');
  assert.equal(run(files, 'j/A.java#A.f', 'j/MyHandler.java#MyHandler.handle'), 'unsure');
  assert.equal(run(files, 'r/a.rs#f', 'r/a.rs#Out.flush'), 'unsure');
});

test('a call on a name that only looks like the callee class is not found', () => {
  const files = {
    'src/cache.ts': 'export class Cache {\n  get() {}\n  static load() {}\n}\n',
    'src/other/cache.ts': 'export class Cache {\n  static load() {}\n}\n',
    'src/log.ts': 'export class Log {\n  get() {}\n  run() { const { get } = this; get(); }\n}\n',
    'src/a.ts': "import { Cache } from './other/cache.ts';\nexport function f() { Cache.load(); }\n",
    'src/lib.rs': 'fn process() {}\nstruct Cache;\nimpl Cache {\n    fn process(&self) {}\n}\nfn run() {\n    process();\n}\n',
    'go.mod': 'module example.com/app\n',
    'store/store.go': 'package store\ntype Store struct{}\nfunc (s *Store) Save() {}\n',
    'api/store.go': 'package api\ntype Store struct{}\nfunc (s *Store) Save() {}\n',
    'api/api.go': 'package api\nfunc Create(s *Store) {\n\ts.Save()\n}\n',
  };
  assert.equal(run(files, 'src/log.ts#Log.run', 'src/cache.ts#Cache.get'), 'not-found');
  assert.equal(run(files, 'src/a.ts#f', 'src/cache.ts#Cache.load'), 'not-found');
  assert.equal(run(files, 'src/lib.rs#run', 'src/lib.rs#Cache.process'), 'not-found');
  assert.equal(run(files, 'api/api.go#Create', 'store/store.go#Store.Save'), 'not-found');
});

test('an edge to a file outside the root is not checked, and its text is never read', () => {
  const read: Read = (full) =>
    full.endsWith('keys.ts') ? 'export const k = "hunter2";\n' : full.endsWith('a.ts') ? 'export function send() {}\n' : null;
  assert.equal(edgeResult(ROOT, 'src/a.ts#send', '../secret/keys.ts', 'hunter2', read).result, 'not-checked');
  assert.equal(edgeResult(ROOT, '../secret/keys.ts', 'src/a.ts#send', 'hunter2', read).result, 'not-checked');
});

test('via in a file of a language that verify does not read is not checked', () => {
  const files = {
    'src/b.rb': '# queue.publish("order-paid")\ndef work; end\n',
    'src/c.ts': "export function recv() { bus.on('order-paid', run); }\n",
  };
  assert.equal(run(files, 'src/b.rb', 'src/c.ts#recv', 'order-paid'), 'not-checked');
});

test('one edge on a 200 KB body with a long number array takes under 1 s', () => {
  const arr = Array.from({ length: 32000 }, (_, i) => i).join(',');
  const files = {
    'src/auth.ts': 'export function verify() {}\n',
    'src/data.ts': `import { verify } from './auth.ts';\nexport function load() {\n  const T = [${arr}];\n  verify();\n}\n`,
  };
  const t = Date.now();
  assert.equal(run(files, 'src/data.ts#load', 'src/auth.ts#verify'), 'found');
  assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
});

test('a namespace re-export leads only to the member that the body calls on it', () => {
  const files = {
    'src/auth.ts': 'export function verify() {}\nexport function hash() {}\n',
    'src/index.ts': "export * as auth from './auth.ts';\n",
    'src/login.ts': "import { auth } from './index.ts';\nexport function login() { auth.hash(); }\n",
    'src/signup.ts': "import { auth } from './index.ts';\nexport function signup() { auth.verify(); }\n",
  };
  assert.equal(run(files, 'src/login.ts#login', 'src/auth.ts#verify'), 'not-found');
  assert.equal(run(files, 'src/signup.ts#signup', 'src/auth.ts#verify'), 'found');
});

test('a Java static import gives found only when it names the callee class and no class in scope declares the name', () => {
  const auth = 'package a;\npublic class Auth {\n  public static void verify() {}\n}\nclass Helper {\n  static void verify() {}\n}\n';
  const files = {
    'src/a/Auth.java': auth,
    'src/b/Login.java': 'package b;\nimport static a.Auth.verify;\npublic class Login {\n  void login() { verify(); }\n}\n',
    'src/b/Outer.java':
      'package b;\nimport static a.Auth.verify;\npublic class Outer {\n  void verify() {}\n  class Inner {\n    void login() { verify(); }\n  }\n}\n',
    'src/b/Act.java':
      'package b;\nimport static a.Auth.verify;\nimport android.app.Activity;\npublic class Act extends Activity {\n  void login() { verify(); }\n}\n',
  };
  assert.equal(run(files, 'src/b/Login.java#Login.login', 'src/a/Auth.java#Auth.verify'), 'found');
  assert.equal(run(files, 'src/b/Login.java#Login.login', 'src/a/Auth.java#Helper.verify'), 'unsure');
  assert.equal(run(files, 'src/b/Outer.java#Outer.Inner.login', 'src/a/Auth.java#Auth.verify'), 'not-found');
  assert.equal(run(files, 'src/b/Act.java#Act.login', 'src/a/Auth.java#Auth.verify'), 'unsure');
});

test('a Java call reads the classes around the call: inner, local and anonymous classes', () => {
  const auth = 'package a;\npublic class Auth {\n  public static void verify() {}\n}\n';
  const outer = 'package b;\npublic class Outer {\n  void verify() {}\n  static class Inner {\n    void login() { verify(); }\n  }\n}\n';
  const files = {
    'src/a/Auth.java': auth,
    'src/b/Outer.java': outer,
    'src/b/Nested.java': outer.replace('package b;\n', 'package b;\nimport static a.Auth.verify;\n').replace(/Outer/g, 'Nested'),
    'src/b/Anon.java':
      'package b;\nimport static a.Auth.verify;\npublic class Anon {\n  void login() {\n    new Runnable() {\n      void verify() {}\n      public void run() { verify(); }\n    };\n  }\n}\n',
    'src/b/Local.java':
      'package b;\nimport static a.Auth.verify;\npublic class Local {\n  void login() {\n    class L { void verify() {} void go() { verify(); } }\n  }\n}\n',
  };
  assert.equal(run(files, 'src/b/Outer.java#Outer.Inner.login', 'src/b/Outer.java#Outer.verify'), 'found');
  assert.equal(run(files, 'src/b/Nested.java#Inner.login', 'src/a/Auth.java#Auth.verify'), 'not-found');
  assert.equal(run(files, 'src/b/Anon.java#Anon.login', 'src/a/Auth.java#Auth.verify'), 'unsure');
  assert.equal(run(files, 'src/b/Local.java#Local.login', 'src/a/Auth.java#Auth.verify'), 'not-found');
});

test('a Python name bound twice in module scope or through an __init__ star import is unsure', () => {
  const py = { 'app/__init__.py': '', 'app/db.py': 'def save():\n    pass\n', 'app/other.py': 'def save():\n    pass\n' };
  const main = 'from app import save\n\ndef create():\n    save()\n';
  const init = (src: string) => ({ ...py, 'app/__init__.py': src, 'main.py': main });
  assert.equal(run(init('from app.other import save\nfrom app.db import *\n'), 'main.py#create', 'app/other.py#save'), 'unsure');
  assert.equal(run(init('from app.db import *\nfrom app.other import save\n'), 'main.py#create', 'app/other.py'), 'unsure');
  const api = (src: string) => run({ ...py, 'app/api.py': `${src}\ndef create():\n    save()\n` }, 'app/api.py#create', 'app/db.py#save');
  assert.equal(api('from app.db import save\nif X:\n    def save():\n        pass\n'), 'unsure');
  assert.equal(api('try:\n    from app.db import save\nexcept ImportError:\n    def save():\n        pass\n'), 'unsure');
  assert.equal(api('from app.db import save\n\ndef other():\n    save = 1\n'), 'found');
  const member = (src: string) =>
    run({ ...py, 'app/api.py': `${src}\ndef create():\n    db.save()\n` }, 'app/api.py#create', 'app/db.py#save');
  assert.equal(member('from app import db\ndb = None\n'), 'unsure');
});

test('a Rust type through a crate path is the repo type only when that module declares it', () => {
  const err = 'pub struct Error {\n    code: u8,\n}\nimpl Error {\n    pub fn kind(&self) -> u8 {\n        self.code\n    }\n}\n';
  const at = (mod: string, use: string) => ({
    'src/lib.rs': 'mod error;\nmod a;\nmod c;\n',
    'src/error.rs': err,
    'src/a.rs': mod,
    'src/c.rs': `${use}\nfn f(e: Error) {\n    e.kind();\n}\n`,
  });
  assert.equal(run(at('pub use std::io::Error;\n', 'use crate::a::Error;'), 'src/c.rs#f', 'src/error.rs#Error.kind'), 'unsure');
  assert.equal(run(at('pub use std::io::*;\n', 'use crate::a::*;'), 'src/c.rs#f', 'src/error.rs#Error.kind'), 'unsure');
  assert.equal(run(at('\n', 'use crate::error::Error;'), 'src/c.rs#f', 'src/error.rs#Error.kind'), 'found');
  const full = { ...at('\n', ''), 'src/c.rs': 'fn f(e: crate::error::Error) {\n    e.kind();\n}\n' };
  assert.equal(run(full, 'src/c.rs#f', 'src/error.rs#Error.kind'), 'found');
});

test('a Rust type re-exported twice inside the crate is found; a std re-export is unsure', () => {
  const err = 'pub struct Error {\n    code: u8,\n}\nimpl Error {\n    pub fn kind(&self) -> u8 {\n        self.code\n    }\n}\n';
  const files = (models: string) => ({
    'src/main.rs': 'mod db;\nmod api;\n',
    'src/db/mod.rs': 'pub mod models;\npub use self::models::*;\n',
    'src/db/models/mod.rs': models,
    'src/db/models/error.rs': err,
    'src/api.rs': 'use crate::db::*;\nfn f(e: Error) {\n    e.kind();\n}\n',
  });
  const edge = (models: string) => run(files(models), 'src/api.rs#f', 'src/db/models/error.rs#Error.kind');
  assert.equal(edge('mod error;\npub use self::error::Error;\n'), 'found');
  assert.equal(edge('mod error;\npub use std::io::Error;\n'), 'unsure');
});

test('a type name unique in the repo but not imported is outside the repo: java.lang and a C# using', () => {
  const files = {
    'src/a/Process.java': 'package a;\npublic class Process {\n  public void destroy() {}\n}\n',
    'src/b/Run.java': 'package b;\npublic class Run {\n  void f(Process p) { p.destroy(); }\n}\n',
    'src/Log/ILogger.cs': 'namespace App.Log;\npublic interface ILogger {\n  void Log(string m);\n}\n',
    'src/Log/ConsoleLogger.cs': 'namespace App.Log;\npublic class ConsoleLogger : ILogger {\n  public void Log(string m) {}\n}\n',
    'src/Web/A.cs': 'using Microsoft.Extensions.Logging;\nnamespace App.Web;\npublic class A {\n  void F(ILogger l) { l.Log("x"); }\n}\n',
  };
  assert.equal(run(files, 'src/b/Run.java#Run.f', 'src/a/Process.java#Process.destroy'), 'unsure');
  assert.equal(run(files, 'src/Web/A.cs#A.F', 'src/Log/ConsoleLogger.cs#ConsoleLogger.Log'), 'unsure');
});

test('a Rust receiver type that the repo does not declare is unsure, not found by the name', () => {
  const files = {
    'src/ext.rs':
      'pub trait Ext {\n    fn map(self) -> u8;\n}\nimpl<T> Ext for Option<T> {\n    fn map(self) -> u8 {\n        0\n    }\n}\n',
    'src/c.rs': 'fn f(x: Option<u8>) {\n    x.map(|v| v + 1);\n}\n',
  };
  assert.equal(run(files, 'src/c.rs#f', 'src/ext.rs#Option.map'), 'unsure');
});

test('a Go dot import and a go.work module lead to the callee', () => {
  const files = {
    'go.work': 'go 1.22\nuse (\n\t./svc\n\t./lib\n)\n',
    'svc/go.mod': 'module example.com/svc\n\nrequire example.com/lib v0.0.0\n',
    'lib/go.mod': 'module example.com/lib\n',
    'lib/store/store.go': 'package store\nfunc Save() {}\n',
    'svc/api/api.go': 'package api\nimport "example.com/lib/store"\nfunc Create() {\n\tstore.Save()\n}\n',
    'svc/dot/dot.go': 'package dot\nimport . "example.com/lib/store"\nfunc Create() {\n\tSave()\n}\n',
  };
  assert.equal(run(files, 'svc/api/api.go#Create', 'lib/store/store.go#Save'), 'found');
  assert.equal(run(files, 'svc/dot/dot.go#Create', 'lib/store/store.go#Save'), 'found');
});

test('a name that can come from a Python star import is unsure, never found or not found', () => {
  const py = { 'app/__init__.py': '', 'app/db.py': 'def save():\n    pass\n', 'app/other.py': 'def save():\n    pass\n' };
  const local = { ...py, 'app/api.py': 'from app.db import *\n\ndef save():\n    pass\n\ndef create():\n    save()\n' };
  const late = { ...py, 'app/api.py': 'from app.other import save\nfrom app.db import *\n\ndef create():\n    save()\n' };
  const all = {
    ...py,
    'app/db.py': "__all__ = ['load']\n\ndef save():\n    pass\n\ndef load():\n    pass\n",
    'app/api.py': 'from app.db import *\nfrom vendor import *\n\ndef create():\n    save()\n',
  };
  assert.equal(run(local, 'app/api.py#create', 'app/db.py#save'), 'unsure');
  assert.equal(run(late, 'app/api.py#create', 'app/db.py#save'), 'unsure');
  assert.equal(run(all, 'app/api.py#create', 'app/db.py'), 'unsure');
});

test('a Python name bound by two imports, or by an import and a definition, is unsure', () => {
  const py = { 'app/__init__.py': '', 'app/db.py': 'def save():\n    pass\n', 'app/other.py': 'def save():\n    pass\n' };
  const two = { ...py, 'app/api.py': 'from app.db import save\nfrom app.other import save\n\ndef create():\n    save()\n' };
  const redef = { ...py, 'app/api.py': 'from app.db import save\n\ndef save():\n    pass\n\ndef create():\n    save()\n' };
  assert.equal(run(two, 'app/api.py#create', 'app/db.py#save'), 'unsure');
  assert.equal(run(redef, 'app/api.py#create', 'app/db.py#save'), 'unsure');
});

test('a Rust type resolves to the repo only through the file, a crate, self or super path; another path is unsure', () => {
  const err = 'pub struct Error {\n    code: u8,\n}\nimpl Error {\n    pub fn kind(&self) -> u8 {\n        self.code\n    }\n}\n';
  const at = (c: string) => ({
    'src/lib.rs': 'mod error;\nmod c;\n',
    'src/error.rs': err,
    'src/c.rs': `${c}fn f(e: Error) {\n    e.kind();\n}\n`,
  });
  const kind = (c: string) => run(at(c), 'src/c.rs#f', 'src/error.rs#Error.kind');
  assert.equal(kind('use std::io::Error;\n'), 'unsure');
  assert.equal(kind('use std::io::{self, Error};\n'), 'unsure');
  assert.equal(kind(''), 'unsure');
  assert.equal(kind('use crate::error::Error;\n'), 'found');
  assert.equal(kind('use super::error::*;\n'), 'found');
  const client = {
    'src/lib.rs': 'mod client;\nmod c;\n',
    'src/client.rs': 'pub struct Client;\nimpl Client {\n    pub fn get(&self) {}\n}\n',
    'src/c.rs': 'use reqwest::Client;\nfn f(c: Client) {\n    c.get();\n}\n',
  };
  assert.equal(run(client, 'src/c.rs#f', 'src/client.rs#Client.get'), 'unsure');
  const alias = {
    ...client,
    'src/client.rs': `${client['src/client.rs']}pub type Shared = Arc<Client>;\n`,
    'src/c.rs': 'use crate::client::Shared;\nfn f(c: Shared) {\n    c.get();\n}\n',
  };
  assert.equal(run(alias, 'src/c.rs#f', 'src/client.rs#Client.get'), 'found');
});

test('a Python re-export through a star import is unsure, not found', () => {
  const files = {
    'app/__init__.py': 'from app.db import *\n',
    'app/db.py': 'def save():\n    pass\n',
    'main.py': 'from app import save\n\ndef create():\n    save()\n',
    'alias.py': 'from app import save as s\n\ndef create():\n    s()\n',
  };
  assert.equal(run(files, 'main.py#create', 'app/db.py#save'), 'unsure');
  assert.equal(run(files, 'alias.py#create', 'app/db.py#save'), 'unsure');
});

test('a Rust function brought in by a use outside the crate is unsure; a crate use is found', () => {
  const at = (u: string) => ({
    'src/lib.rs': 'mod fs;\nmod c;\n',
    'src/fs.rs': 'pub fn read() {}\n',
    'src/c.rs': `${u}fn f() {\n    read();\n}\n`,
  });
  assert.equal(run(at('use std::fs::read;\n'), 'src/c.rs#f', 'src/fs.rs#read'), 'unsure');
  assert.equal(run(at('use crate::fs::read;\n'), 'src/c.rs#f', 'src/fs.rs#read'), 'found');
});

test('via: a path token after a port is found when the callee file holds it outside the callee body', () => {
  const files = {
    'gateway/index.ts': 'export const callUsers = () => fetch("http://users:3000/internal/users");\n',
    'users/index.ts': 'app.get("/internal/users", listUsers);\nexport function listUsers(req, res) { res.json([]); }\n',
    'pricing/index.ts': '// pricing service\nexport function quote() {}\n',
  };
  assert.equal(run(files, 'gateway/index.ts#callUsers', 'users/index.ts#listUsers', '/internal/users'), 'found');
  assert.equal(run(files, 'gateway/index.ts#callUsers', 'pricing/index.ts#quote', '/internal/users'), 'not-found');
});

test('via: a token in a string with a longer path or name is unsure; in code a member access is found', () => {
  const files = {
    'gw.ts':
      'export const f = () => fetch("http://admin:3000/internal-admin/stats");\nexport const g = () => fetch("http://x/internal.json");\nexport const h = () => fetch("http://x/internal/users");\nexport const k = () => fetch("http://x/internals");\n',
    'a.ts': 'export function f() { bus.publish("order-paid-v2", x); }\n',
    'jobs.py': 'def check_alerts():\n    pass\n',
    'run.py': 'from jobs import check_alerts\n\ndef run():\n    check_alerts.delay(1)\n',
  };
  for (const caller of ['gw.ts#f', 'gw.ts#g', 'gw.ts#h']) assert.equal(run(files, caller, undefined, '/internal'), 'unsure', caller);
  assert.equal(run(files, 'gw.ts#k', undefined, '/internal'), 'not-found');
  assert.equal(run(files, 'a.ts#f', undefined, 'order-paid'), 'unsure');
  assert.equal(run(files, 'run.py#run', 'jobs.py#check_alerts', 'check_alerts'), 'found');
});

test('via: a module constant is unsure when the caller has a local, a parameter or a member of the same name', () => {
  const consumer = { 'w.py': 'def consume():\n    ch.basic_consume("audit-events", m)\n' };
  const at = (src: string, path = 'a.ts') => ({ ...consumer, [path]: src });
  const ts = 'const QUEUE = "audit-events";\nexport function f';
  assert.equal(run(at(`${ts}() { ch.sendToQueue(cfg.QUEUE, b); }\n`), 'a.ts#f', 'w.py#consume', 'audit-events'), 'unsure');
  assert.equal(
    run(at(`${ts}() { const QUEUE = "billing"; ch.sendToQueue(QUEUE, b); }\n`), 'a.ts#f', 'w.py#consume', 'audit-events'),
    'unsure',
  );
  assert.equal(run(at(`${ts}(QUEUE) { ch.sendToQueue(QUEUE, b); }\n`), 'a.ts#f', 'w.py#consume', 'audit-events'), 'unsure');
  assert.equal(
    run(at('QUEUE = "audit-events"\n\ndef f(QUEUE):\n    ch.send(QUEUE)\n', 'a.py'), 'a.py#f', 'w.py#consume', 'audit-events'),
    'unsure',
  );
});

test('via: a callee token only on an import or log line, or in another function of the callee file, is unsure', () => {
  const caller = { 'gw.ts': 'export const f = () => fetch("http://p:3000/internal/quote");\n' };
  const at = (src: string) => ({ ...caller, 'p.ts': src });
  const callee = (src: string, to: string) => run(at(src), 'gw.ts#f', to, '/internal/quote');
  assert.equal(callee('import { db } from "../lib/internal/quote";\nexport function quote() {}\n', 'p.ts#quote'), 'unsure');
  assert.equal(
    callee('export function quote() { log.info("not served: /internal/quote"); }\nexport function other() {}\n', 'p.ts#other'),
    'unsure',
  );
  assert.equal(callee('app.get("/internal/quote", pay);\nexport function pay() {}\nexport function ship() {}\n', 'p.ts#ship'), 'unsure');
  assert.equal(callee('app.get("/internal/quote", pay);\nexport function pay() {}\nexport function ship() {}\n', 'p.ts'), 'found');
});

test('via: the caller can hold the token in a top-level constant of its file', () => {
  const files = {
    'src/audit.ts':
      'const QUEUE = "audit-events";\nconst OTHER = "billing";\nexport function write() { ch.sendToQueue(QUEUE, b); }\nexport function bill() { ch.sendToQueue(OTHER, b); }\n',
    'worker/consume.py': 'QUEUE = "audit-events"\n\ndef consume():\n    ch.basic_consume(QUEUE, on_message)\n',
  };
  assert.equal(run(files, 'src/audit.ts#write', 'worker/consume.py#consume', 'audit-events'), 'found');
  assert.equal(run(files, 'src/audit.ts#bill', 'worker/consume.py#consume', 'audit-events'), 'not-found');
});

test('a middleware passed as a route argument is found; another middleware is not found', () => {
  const files = {
    'src/limit.ts': 'export function loginRateLimit(req, res, next) { next(); }\nexport function otherLimit(req, res, next) { next(); }\n',
    'src/auth.ts':
      "import { Router } from 'express';\nimport { loginRateLimit } from './limit.ts';\nexport const authRouter = Router();\n" +
      'authRouter.post("/login", loginRateLimit, async (req, res) => { res.json({}); });\n',
    'src/admin.ts': "import { otherLimit } from './limit.ts';\napp.post('/admin', otherLimit, async (req, res) => { res.json({}); });\n",
  };
  assert.equal(run(files, 'src/auth.ts', 'src/limit.ts#loginRateLimit'), 'found');
  assert.equal(run(files, 'src/admin.ts', 'src/limit.ts#loginRateLimit'), 'not-found');
});

test('a not-found edge asks for via only from a TS or Python caller with no import path to the callee file', () => {
  const files = {
    'src/a.ts': 'export function a() {}\n',
    'src/b.ts': "import { a } from './a.ts';\nexport function b() {}\n",
    'src/c.ts': 'export function c() {}\n',
  };
  const reason = (caller: string) => edgeResult(ROOT, caller, 'src/a.ts#a', undefined, repo(files)).reason;
  assert.match(reason('src/c.ts#c'), /if this edge crosses a process, add via$/);
  assert.doesNotMatch(reason('src/b.ts#b'), /add via/);
  const rs = {
    'src/lib.rs': 'mod fs;\nmod c;\n',
    'src/fs.rs': 'pub fn read() {}\npub fn write() {}\n',
    'src/c.rs': 'use crate::fs::write;\nfn f() {\n    write();\n}\n',
  };
  assert.doesNotMatch(edgeResult(ROOT, 'src/c.rs#f', 'src/fs.rs#read', undefined, repo(rs)).reason, /add via/);
});

test('a call through a default export that wraps the callee is unsure, not "not found"', () => {
  const files = {
    'src/mover.ts': 'async function documentMover() {}\nexport default traceFunction({ spanName: "x" })(documentMover);\n',
    'src/api.ts': "import documentMover from './mover.ts';\nexport function move() { documentMover(); }\n",
  };
  assert.equal(run(files, 'src/api.ts#move', 'src/mover.ts#documentMover'), 'unsure');
});

test('via: a callee line that only looks like an import or a log call still counts', () => {
  const w = { 'w.ts': 'export function save() { db.query("INSERT INTO orders VALUES (1)"); }\n' };
  const cs =
    'namespace App;\npublic class R {\n  public void Load(Conn c) {\n    using var cmd = new SqlCommand("SELECT * FROM orders", c);\n  }\n}\n';
  assert.equal(run({ ...w, 'R.cs': cs }, 'w.ts#save', 'R.cs#R.Load', 'orders'), 'found');
  assert.equal(
    run({ ...w, 'r.py': 'def load(cur):\n    cur.execute(\'SELECT * FROM "orders"\')\n' }, 'w.ts#save', 'r.py#load', 'orders'),
    'found',
  );
  const go = 'package u\n\nfunc List(w W, r *R) {\n\tif r.URL.Path != "/internal/users" { http.Error(w, "no", 404) }\n}\n';
  const gw = { 'gw.ts': 'export const f = () => fetch("http://u/internal/users");\n' };
  assert.equal(run({ ...gw, 'u.go': go }, 'gw.ts#f', 'u.go#List', '/internal/users'), 'found');
});

test('a Java class header longer than the scan window gives unsure', () => {
  const bases = Array.from({ length: 20 }, (_, i) => `HandlerContract${i}<RequestEnvelope, ResponseEnvelope>`).join(',\n        ');
  const outer = `package b;\npublic class Outer {\n  static class Inner extends Base\n      implements ${bases} {\n    void verify() {}\n    void login() { verify(); }\n  }\n}\n`;
  assert.equal(run({ 'src/b/Outer.java': outer }, 'src/b/Outer.java#Outer.Inner.login', 'src/b/Outer.java#Outer.Inner.verify'), 'unsure');
});

test('a 20,000-line Java file with a long enum gives one edge result in under 1 s', () => {
  const values = Array.from({ length: 20000 }, (_, i) => `    V${i},`).join('\n');
  const java = `package u;\npublic class Codes {\n  static String P = "/internal/users";\n  public void a() {}\n  public void b() {}\n  enum E {\n${values}\n  }\n}\n`;
  const files = { 'gw.ts': 'export const f = () => fetch("http://u/internal/users");\n', 'u/Codes.java': java };
  const start = performance.now();
  run(files, 'gw.ts#f', 'u/Codes.java#Codes.b', '/internal/users');
  assert.ok(performance.now() - start < 1000);
});

test('a Rust re-export chain with a private item, a private use, a test module or an inline module is unsure', () => {
  const err = 'pub struct Error {\n    code: u8,\n}\nimpl Error {\n    pub fn kind(&self) -> u8 {\n        self.code\n    }\n}\n';
  const api = (use: string) => `${use}\nfn f(e: Error) {\n    e.kind();\n}\n`;
  const crate = (models: string, error = err) => ({
    'src/main.rs': 'mod db;\nmod util;\nmod api;\n',
    'src/db/mod.rs': 'pub mod models;\npub use self::models::*;\n',
    'src/db/models/mod.rs': models,
    'src/db/models/error.rs': error,
    'src/util.rs': 'pub use std::io::Error;\n',
    'src/api.rs': api('use crate::db::*;\nuse crate::util::*;'),
  });
  const edge = (files: Record<string, string>) => run(files, 'src/api.rs#f', 'src/db/models/error.rs#Error.kind');
  assert.equal(edge(crate('mod error;\npub use self::error::*;\n', err.replace('pub struct', 'struct'))), 'unsure');
  assert.equal(edge(crate('mod error;\nuse self::error::Error;\n')), 'unsure');
  assert.equal(edge(crate('#[cfg(test)]\nmod tests {\n    use crate::db::models::error::Error;\n}\nmod error;\n')), 'unsure');
  const inline = {
    'src/main.rs': 'mod db;\nmod api;\n',
    'src/db.rs': `pub mod inner {\n${err}}\npub use std::io::Error;\n`,
    'src/api.rs': api('use crate::db::Error;'),
  };
  assert.equal(run(inline, 'src/api.rs#f', 'src/db.rs#Error.kind'), 'unsure');
});

test('an edge is unsure, not "not found", when the caller passes control to a parameter such as next()', () => {
  const files = {
    'src/limit.ts': 'export function limit(req: Req, res: Res, next: Next) {\n  if (req.ip) next();\n}\n',
    'src/routes.ts': 'export const router = makeRouter();\n',
    'app/hooks.py': 'def run(event, done):\n    done(event)\n',
    'app/save.py': 'def save(event):\n    pass\n',
  };
  assert.equal(run(files, 'src/limit.ts#limit', 'src/routes.ts#router'), 'unsure');
  assert.equal(run(files, 'app/hooks.py#run', 'app/save.py#save'), 'unsure');
});
