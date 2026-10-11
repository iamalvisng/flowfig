import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownFont } from './model.ts';

const scale = { map: 0.5, rail: 2 };

test('shownFont multiplies the size by the scale of the place that draws the text', () => {
  assert.equal(shownFont(10, 'map', scale), 5);
  assert.equal(shownFont(10, 'rail', scale), 20);
  assert.equal(shownFont(10, 'plain', scale), 10);
});

test('shownFont gives a different size for each place, so one global scale fails', () => {
  const sizes = (['map', 'rail', 'plain'] as const).map((place) => shownFont(11, place, scale));
  assert.equal(new Set(sizes).size, 3);
  assert.equal(Math.min(...sizes), 5.5);
});
