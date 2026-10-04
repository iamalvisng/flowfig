import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Read } from './code.ts';
import { edgeResult } from './edges.ts';

const repo = (files: Record<string, string>): Read =>
  Object.assign((full: string) => files[full.replace(/\\/g, '/').replace(/^\/r\//, '')] ?? null, { files: () => Object.keys(files) });
const run = (files: Record<string, string>, caller: string, callee?: string, via?: string) =>
  edgeResult('/r', caller, callee, via, repo(files)).result;

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

test('an edge to a file outside the root is not checked, and its text is never read', () => {
  const read: Read = (full) =>
    full.endsWith('keys.ts') ? 'export const k = "hunter2";\n' : full.endsWith('a.ts') ? 'export function send() {}\n' : null;
  assert.equal(edgeResult('/r', 'src/a.ts#send', '../secret/keys.ts', 'hunter2', read).result, 'not-checked');
  assert.equal(edgeResult('/r', '../secret/keys.ts', 'src/a.ts#send', 'hunter2', read).result, 'not-checked');
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
