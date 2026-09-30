import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from './verify.ts';

test('parseSource reads a path and an optional symbol', () => {
  assert.deepEqual(parseSource('src/a.ts'), { path: 'src/a.ts' });
  assert.deepEqual(parseSource('src/a.ts#f'), { path: 'src/a.ts', symbol: 'f' });
  for (const bad of ['', 'a.ts#', '#f', 'a b.ts', 'a.ts#f#g', 'a.ts#f g']) assert.equal(parseSource(bad), null, bad);
});
