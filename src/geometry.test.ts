import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from './geometry.ts';

test('side by side boxes connect right -> left, parallel edges spread out', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 90 }, b: { x: 200, y: 0, w: 100, h: 90 } };
  const out = route(
    [
      { id: '1', from: 'a', to: 'b' },
      { id: '2', from: 'a', to: 'b' },
    ],
    rects,
  );
  assert.equal(out[0].d, 'M 100 30 C 150 30, 150 30, 200 30');
  assert.equal(out[1].d, 'M 100 60 C 150 60, 150 60, 200 60');
  assert.deepEqual(out[0].mid, { x: 150, y: 30 });
});

test('stacked boxes connect bottom -> top, and upward edges go top -> bottom', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 0, y: 100, w: 100, h: 40 } };
  const [down, up] = route(
    [
      { id: 'd', from: 'a', to: 'b' },
      { id: 'u', from: 'b', to: 'a' },
    ],
    rects,
  );
  assert.match(down.d, /^M \S+ 40 .* 100$/);
  assert.match(up.d, /^M \S+ 100 .* 40$/);
});

test('edges to unknown boxes are skipped', () => {
  assert.deepEqual(route([{ id: 'x', from: 'a', to: 'nope' }], { a: { x: 0, y: 0, w: 1, h: 1 } }), []);
});

test('diamonds: edges on one side meet at the tip', () => {
  const rects = { c: { x: 0, y: 0, w: 100, h: 60 }, yes: { x: 200, y: -100, w: 100, h: 40 }, no: { x: 200, y: 100, w: 100, h: 40 } };
  const out = route(
    [
      { id: 'y', from: 'c', to: 'yes' },
      { id: 'n', from: 'c', to: 'no' },
    ],
    rects,
    new Set(['c']),
  );
  assert.ok(out.every((r) => r.d.startsWith('M 100 30 ')));
});

test('around: below arcs under both boxes, bottom to bottom', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 400, y: 0, w: 100, h: 60 } };
  const [r] = route([{ id: 'x', from: 'a', to: 'b', around: 'below' }], rects);
  assert.equal(r.d, 'M 50 40 C 50 110, 450 110, 450 60');
});

test('every route carries the four points its path is drawn from', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 200, y: 0, w: 100, h: 40 }, c: { x: 0, y: 100, w: 100, h: 40 } };
  const routes = route(
    [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c', around: 'below' },
    ],
    rects,
  );
  for (const r of routes) {
    const [s, c1, c2, e] = r.curve;
    assert.equal(r.d, `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`);
  }
});

test('elbow: with a gap under 16 px, the last run still enters the target going forward', () => {
  for (const gap of [12, 8, 0, -20]) {
    const rects = { a: { x: 0, y: 0, w: 100, h: 28 }, b: { x: 100 + gap, y: 40, w: 100, h: 28 } };
    const [r] = route([{ id: 'e', from: 'a', to: 'b', sides: ['r', 'l'], elbow: true }], rects);
    const m = r.d.match(/H ([\d.-]+) V [\d.-]+ H ([\d.-]+)$/);
    assert.ok(m, `gap ${gap}: ${r.d}`);
    assert.equal(Number(m[2]) - Number(m[1]), 8, `gap ${gap}: the last run goes 8 px forward: ${r.d}`);
  }
  const [wide] = route([{ id: 'e', from: 'a', to: 'b', sides: ['r', 'l'], elbow: true }], {
    a: { x: 0, y: 0, w: 100, h: 28 },
    b: { x: 140, y: 40, w: 100, h: 28 },
  });
  assert.equal(wide.d, 'M 100 14 H 120 V 54 H 140');
});
