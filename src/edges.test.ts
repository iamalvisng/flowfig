import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeResult } from './edges.ts';

const repo = (files: Record<string, string>) => (full: string) => {
  const key = full.replace(/\\/g, '/').replace(/^\/r\//, '');
  return files[key] ?? null;
};
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
