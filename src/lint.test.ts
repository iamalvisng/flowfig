import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../scripts/lint-fixtures/', import.meta.url));
const bin = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));

test('each lint rule reports the fixture that breaks it and passes the one that does not', () => {
  const r = spawnSync(process.execPath, [bin, '-c', dir + 'oxlintrc.json', '-f', 'json', dir], { encoding: 'utf8' });
  const found: Record<string, string[]> = {};
  for (const d of JSON.parse(r.stdout).diagnostics) {
    (found[d.filename.split('/').pop()] ??= []).push(d.code);
  }
  for (const codes of Object.values(found)) codes.sort();
  assert.deepEqual(found, {
    'test-asserts.js': ['flowfig(test-asserts)'],
    'svg-snapshot.js': ['flowfig(svg-snapshot)'],
    'comments-long.js': ['flowfig(comments)'],
    'comments-code.js': ['flowfig(comments)'],
    'comments-doc.js': ['flowfig(comments)'],
    'no-console.js': ['eslint(no-console)'],
    'no-todo.js': ['eslint(no-warning-comments)', 'flowfig(comments)'],
  });
});
