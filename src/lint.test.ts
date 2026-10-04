import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../scripts/lint-fixtures/', import.meta.url));
const bin = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));

test('each lint rule reports the fixture that breaks it and passes the one that does not', () => {
  const r = spawnSync(process.execPath, [bin, '-c', dir + 'oxlintrc.json', '-f', 'json', dir], { encoding: 'utf8' });
  const found: Record<string, string[]> = {};
  for (const d of JSON.parse(r.stdout).diagnostics) {
    (found[basename(d.filename)] ??= []).push(d.code);
  }
  for (const codes of Object.values(found)) codes.sort();
  assert.deepEqual(found, {
    'test-asserts.js': ['flowfig(test-asserts)'],
    'test-asserts-comment.js': ['flowfig(test-asserts)'],
    'comments-lines.js': ['flowfig(comments)'],
    'comments-type-doc.ts': ['flowfig(comments)'],
    'comments-fn-doc.ts': ['flowfig(comments)'],
    'svg-snapshot.js': ['flowfig(svg-snapshot)', 'flowfig(svg-snapshot)'],
    'comments-long.js': ['flowfig(comments)'],
    'comments-code.js': ['flowfig(comments)'],
    'comments-doc.js': ['flowfig(comments)'],
    'no-console.js': ['eslint(no-console)'],
    'no-todo.js': ['eslint(no-warning-comments)', 'flowfig(comments)'],
  });
});
