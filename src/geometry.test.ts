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

test('elbow: boxes on one row draw a straight forward line, with no detour', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 28 }, b: { x: 108, y: 0, w: 100, h: 28 } };
  const [r] = route([{ id: 'e', from: 'a', to: 'b', sides: ['r', 'l'], elbow: true }], rects);
  assert.equal(r.d, 'M 100 14 H 108');
});

test('an elbow moves its vertical run clear of an outside label, then falls back to the midpoint', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 28 }, b: { x: 300, y: 60, w: 100, h: 28 } };
  const elbow = [{ id: 'e', from: 'a', to: 'b', sides: ['r', 'l'] as ['r', 'l'], elbow: true }];
  // the midpoint x is 200; the label spans 150 to 250
  const label = { x: 150, y: 10, w: 100, h: 28 };
  assert.match(route(elbow, rects, new Set(), [])[0].d, /H 200 V/, 'no label: the midpoint');
  assert.match(route(elbow, rects, new Set(), [label])[0].d, /H 292 V/, 'a label at the midpoint: 8 px before the end');
  const wide = { x: 150, y: 10, w: 150, h: 28 }; // reaches the target too
  assert.match(route(elbow, rects, new Set(), [wide])[0].d, /H 108 V/, 'then 8 px after the start');
  const off = { x: 150, y: 200, w: 100, h: 28 }; // below the run
  assert.match(route(elbow, rects, new Set(), [off])[0].d, /H 200 V/, 'a label off the run is ignored');
});

test('stub: each pill takes the first clear place, else the first place', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 400, y: 300, w: 100, h: 50 } };
  const pills = (avoid: { x: number; y: number; w: number; h: number }[]) =>
    route([{ id: 'e', from: 'a', to: 'b', stub: [60, 60] }], rects, new Set(), avoid)[0].stub!.pills.map((p) => [p.x, p.y]);
  // 1: right of the source, left of the target.
  assert.deepEqual(pills([]), [
    [112, 16],
    [328, 316],
  ]);
  // 2: right and under the bottom edge.
  assert.deepEqual(pills([{ x: 110, y: 14, w: 70, h: 22 }])[0], [112, 52]);
  // 3: right and over the top edge.
  assert.deepEqual(pills([{ x: 110, y: 14, w: 70, h: 60 }])[0], [112, -20]);
  // 5: below the source (4, one pill lower, is taken too).
  assert.deepEqual(pills([{ x: 110, y: -30, w: 70, h: 110 }])[0], [20, 62]);
  // The target pill: left and under the bottom edge, when its left place is taken (under and over tie; under comes first).
  assert.deepEqual(pills([{ x: 320, y: 312, w: 70, h: 22 }])[1], [328, 352]);
  // No clear place: the first place stays, and check reports it.
  assert.deepEqual(pills([{ x: -1000, y: -1000, w: 3000, h: 3000 }]), [
    [112, 16],
    [328, 316],
  ]);
});

test('stub: a pill keeps clear of the path of another edge', () => {
  const rects = {
    a: { x: 0, y: 0, w: 100, h: 50 },
    b: { x: 400, y: 300, w: 100, h: 50 },
    c: { x: 112, y: -100, w: 40, h: 20 },
    d: { x: 112, y: 200, w: 40, h: 20 },
  };
  // c -> d runs down through the first place of the source pill.
  const [, e] = route(
    [
      { id: 'cd', from: 'c', to: 'd' },
      { id: 'e', from: 'a', to: 'b', stub: [60, 60] },
    ],
    rects,
  );
  assert.notDeepEqual([e.stub!.pills[0].x, e.stub!.pills[0].y], [112, 16]);
});

test('stub: with a band, a pill stays inside it, 4 px from the border, and slides to the nearest clear place', () => {
  const rects = { a: { x: 0, y: 20, w: 100, h: 50 }, b: { x: 400, y: 300, w: 100, h: 50 } };
  const band = { x: -20, y: 0, w: 400, h: 90 };
  const pills = (avoid: { x: number; y: number; w: number; h: number }[]) =>
    route([{ id: 'e', from: 'a', to: 'b', stub: [60, 60], bands: [band, undefined] }], rects, new Set(), avoid)[0].stub!.pills[0];
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= band.x + 4 && r.x + r.w <= band.x + band.w - 4 && r.y >= band.y + 4 && r.y + r.h <= band.y + band.h - 4;
  assert.deepEqual([pills([]).x, pills([]).y], [112, 36]);
  // A box right of the source takes the first place: the pill moves up or down in the band, or further right, and stays inside.
  const moved = pills([{ x: 110, y: 30, w: 70, h: 30 }]);
  assert.ok(inside(moved) && !(moved.x === 112 && moved.y === 36));
  // No place inside the band: the first place stays, and check reports it.
  const stuck = pills([{ x: -1000, y: -1000, w: 3000, h: 3000 }]);
  assert.deepEqual([stuck.x, stuck.y], [112, 36]);
});
