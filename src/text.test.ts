import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textWidth } from './text.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('monospace is 0.6em a character', () => {
  near(textWidth('abcd', 10, true), 24);
});

test('CJK and emoji take a full em in any font', () => {
  near(textWidth('日本', 10), 20);
  near(textWidth('🚀', 10, true), 10);
});

test('wide letters count more than narrow ones', () => {
  assert.ok(textWidth('WWWW', 10) > textWidth('iiii', 10) * 2);
});
