import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelAlong, route, samples, type Pt, type Routed } from './geometry.ts';

const bezier = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};

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
  const label = { x: 150, y: 10, w: 100, h: 28 };
  assert.match(route(elbow, rects, new Set(), [])[0].d, /H 200 V/, 'no label: the midpoint');
  assert.match(route(elbow, rects, new Set(), [label])[0].d, /H 292 V/, 'a label at the midpoint: 8 px before the end');
  const wide = { x: 150, y: 10, w: 150, h: 28 };
  assert.match(route(elbow, rects, new Set(), [wide])[0].d, /H 108 V/, 'then 8 px after the start');
  const off = { x: 150, y: 200, w: 100, h: 28 };
  assert.match(route(elbow, rects, new Set(), [off])[0].d, /H 200 V/, 'a label off the run is ignored');
});

test('stub: each pill takes the first clear place, else the first place', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 400, y: 300, w: 100, h: 50 } };
  const pills = (avoid: { x: number; y: number; w: number; h: number }[]) =>
    route([{ id: 'e', from: 'a', to: 'b', stub: [60, 60] }], rects, new Set(), avoid)[0].stub!.pills.map((p) => [p.x, p.y]);
  assert.deepEqual(pills([]), [
    [112, 16],
    [328, 316],
  ]);
  assert.deepEqual(pills([{ x: 110, y: 14, w: 70, h: 22 }])[0], [112, 52]);
  assert.deepEqual(pills([{ x: 110, y: 14, w: 70, h: 60 }])[0], [112, -20]);
  assert.deepEqual(pills([{ x: 110, y: -30, w: 70, h: 110 }])[0], [20, 62]);
  assert.deepEqual(pills([{ x: 320, y: 312, w: 70, h: 22 }])[1], [328, 352]);
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
  const [, e] = route(
    [
      { id: 'cd', from: 'c', to: 'd' },
      { id: 'e', from: 'a', to: 'b', stub: [60, 60] },
    ],
    rects,
  );
  assert.notDeepEqual([e.stub!.pills[0].x, e.stub!.pills[0].y], [112, 16]);
});

test('stub: a stub line does not cross the path of another edge', () => {
  const rects = {
    a: { x: 0, y: 0, w: 100, h: 50 },
    b: { x: 400, y: 300, w: 100, h: 50 },
    c: { x: 96, y: -100, w: 20, h: 20 },
    d: { x: 96, y: 200, w: 20, h: 20 },
  };
  const [, e] = route(
    [
      { id: 'cd', from: 'c', to: 'd' },
      { id: 'e', from: 'a', to: 'b', stub: [60, 60] },
    ],
    rects,
  );
  assert.notDeepEqual([e.stub!.pills[0].x, e.stub!.pills[0].y], [112, 16]);
  const [a, b] = e.stub!.pts[0];
  assert.ok(!(Math.min(a.x, b.x) < 106 && Math.max(a.x, b.x) > 106 && Math.min(a.y, b.y) < 200 && Math.max(a.y, b.y) > -80));
});

test('stub: with a band, a pill stays inside it, 4 px from the border, and slides to the nearest clear place', () => {
  const rects = { a: { x: 0, y: 20, w: 100, h: 50 }, b: { x: 400, y: 300, w: 100, h: 50 } };
  const band = { x: -20, y: 0, w: 400, h: 90 };
  const pills = (avoid: { x: number; y: number; w: number; h: number }[]) =>
    route([{ id: 'e', from: 'a', to: 'b', stub: [60, 60], bands: [band, undefined] }], rects, new Set(), avoid)[0].stub!.pills[0];
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= band.x + 4 && r.x + r.w <= band.x + band.w - 4 && r.y >= band.y + 4 && r.y + r.h <= band.y + band.h - 4;
  assert.deepEqual([pills([]).x, pills([]).y], [112, 36]);
  const moved = pills([{ x: 110, y: 30, w: 70, h: 30 }]);
  assert.ok(inside(moved) && !(moved.x === 112 && moved.y === 36));
  const stuck = pills([{ x: -1000, y: -1000, w: 3000, h: 3000 }]);
  assert.deepEqual([stuck.x, stuck.y], [112, 36]);
});

test('an elbow keeps clear of a box it does not connect: a clear x in the gap, else a detour around it', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 28 }, b: { x: 300, y: 200, w: 100, h: 28 } };
  const elbow = [{ id: 'e', from: 'a', to: 'b', sides: ['r', 'l'] as ['r', 'l'], elbow: true }];
  const own = [
    { ...rects.a, box: true },
    { ...rects.b, box: true },
  ];
  const mid = { x: 150, y: 80, w: 100, h: 28, box: true };
  assert.match(route(elbow, rects, new Set(), [...own, mid])[0].d, /H 292 V/);
  const wide = { x: 104, y: 80, w: 250, h: 28, box: true };
  const [r] = route(elbow, rects, new Set(), [...own, wide]);
  assert.equal(r.elbow!.length, 6, 'a five-run detour');
  for (let k = 1; k < r.elbow!.length; k++) {
    const [p, q] = [r.elbow![k - 1], r.elbow![k]];
    const hit =
      Math.max(p.x, q.x) > wide.x &&
      Math.min(p.x, q.x) < wide.x + wide.w &&
      Math.max(p.y, q.y) > wide.y &&
      Math.min(p.y, q.y) < wide.y + wide.h;
    assert.ok(!hit, `run ${k} crosses the box`);
  }
  assert.ok(r.elbow![1].x >= wide.x + wide.w + 8, 'the detour passes right of the box');
  assert.match(route(elbow, rects, new Set(), [{ x: 104, y: 80, w: 250, h: 28 }])[0].d, /^M 100 14 H 200 V 214 H 300$/);
});

test('an edge whose straight path crosses a box in a row goes around it', () => {
  const rects = { a: { x: 0, y: 100, w: 100, h: 40 }, b: { x: 150, y: 100, w: 100, h: 40 }, c: { x: 300, y: 100, w: 100, h: 40 } };
  const avoid = Object.values(rects).map((r) => ({ ...r, box: true as const }));
  const [r] = route([{ id: 'a->c', from: 'a', to: 'c' }], rects, new Set(), avoid);
  assert.ok(r.around === 'above' || r.around === 'below');
  for (let t = 0; t <= 1; t += 0.03) {
    const p = bezier(r.curve, t);
    assert.ok(!(p.x > 150 && p.x < 250 && p.y > 100 && p.y < 140), `point ${t} is inside b`);
  }
});

test('an edge between stacked boxes with a box between them goes around at the side', () => {
  const rects = { a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 0, y: 80, w: 100, h: 40 }, c: { x: 0, y: 160, w: 100, h: 40 } };
  const avoid = Object.values(rects).map((r) => ({ ...r, box: true as const }));
  const [r] = route([{ id: 'a->c', from: 'a', to: 'c' }], rects, new Set(), avoid);
  assert.ok(r.around === 'left' || r.around === 'right');
});

test('an edge with both detour heights blocked steps the arc out past the blocking boxes', () => {
  const rects = {
    a: { x: 0, y: 100, w: 100, h: 40 },
    b: { x: 150, y: 100, w: 100, h: 40 },
    c: { x: 300, y: 100, w: 100, h: 40 },
    up: { x: 100, y: 0, w: 220, h: 100 },
    dn: { x: 100, y: 140, w: 220, h: 100 },
  };
  const avoid = Object.values(rects).map((r) => ({ ...r, box: true as const }));
  const [r] = route([{ id: 'a->c', from: 'a', to: 'c' }], rects, new Set(), avoid);
  assert.ok(r.around === 'above' || r.around === 'below');
  for (let t = 0; t <= 1; t += 0.03) {
    const p = bezier(r.curve, t);
    assert.ok(
      !avoid.some((q) => p.x > q.x + 2 && p.x < q.x + q.w - 2 && p.y > q.y + 2 && p.y < q.y + q.h - 2),
      `point ${t} is inside a box`,
    );
  }
});

test('a set around that crosses a box in a grid is drawn clear of every box', () => {
  const col = (x: number, ys: number[]) => ys.map((y) => ({ x, y, w: 100, h: 40 }));
  const [cli, server, cleanup] = col(0, [0, 80, 130]);
  const [convert, preview] = col(200, [0, 80]);
  const [out] = col(400, [0]);
  const rects = { cli, server, cleanup, convert, preview, out };
  const avoid = Object.values(rects).map((r) => ({ ...r, box: true as const }));
  const [r] = route([{ id: 's', from: 'server', to: 'out', around: 'below' }], rects, new Set(), avoid);
  const line = r.elbow;
  const steps = line
    ? line.slice(1).flatMap((q, k) =>
        Array.from({ length: 17 }, (_, i) => ({
          x: line[k].x + ((q.x - line[k].x) * i) / 16,
          y: line[k].y + ((q.y - line[k].y) * i) / 16,
        })),
      )
    : Array.from({ length: 33 }, (_, i) => bezier(r.curve, i / 32));
  for (const [id, q] of Object.entries(rects).filter(([id]) => id !== 'server' && id !== 'out'))
    assert.ok(!steps.some((p) => p.x > q.x + 2 && p.x < q.x + q.w - 2 && p.y > q.y + 2 && p.y < q.y + q.h - 2), `the path crosses ${id}`);
});

test('two detours over the same boxes take the two sides and do not cross', () => {
  const rects = { a: { x: 0, y: 100, w: 100, h: 40 }, b: { x: 150, y: 100, w: 100, h: 40 }, c: { x: 300, y: 100, w: 100, h: 40 } };
  const avoid = Object.values(rects).map((r) => ({ ...r, box: true as const }));
  const [go, back] = route(
    [
      { id: 'a->c', from: 'a', to: 'c' },
      { id: 'c->a', from: 'c', to: 'a' },
    ],
    rects,
    new Set(),
    avoid,
  );
  assert.deepEqual([go.around, back.around].sort(), ['above', 'below']);
});

test('an edge label moves off a box on the curve middle, and stays at the middle with no free spot', () => {
  const curve: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 300, y: 0 },
  ];
  const r: Routed = { id: 'e', d: '', mid: { x: 150, y: 0 }, curve };
  const box = { x: 130, y: -10, w: 40, h: 20 };
  const q = labelAlong(r, 40, [box], []);
  assert.ok(q.x + 20 < box.x - 1 || q.x - 20 > box.x + box.w + 1 || q.y + 9 < box.y - 1 || q.y - 9 > box.y + box.h + 1);
  assert.deepEqual(labelAlong(r, 40, [{ x: -50, y: -50, w: 400, h: 100 }], []), r.mid);
});

const through = (r: Routed, box: { x: number; y: number; w: number; h: number }) => {
  const line = r.elbow ?? [];
  const pts = r.elbow
    ? line.slice(1).flatMap((q, k) =>
        Array.from({ length: 65 }, (_, i) => ({
          x: line[k].x + ((q.x - line[k].x) * i) / 64,
          y: line[k].y + ((q.y - line[k].y) * i) / 64,
        })),
      )
    : samples(r.curve);
  return pts.some((q) => q.x > box.x + 6 && q.x < box.x + box.w - 6 && q.y > box.y + 6 && q.y < box.y + box.h - 6);
};
const solid = (rs: Record<string, { x: number; y: number; w: number; h: number }>) => Object.values(rs).map((r) => ({ ...r, box: true }));

test('a long arc steps over a narrow box', () => {
  const long = { a: { x: 0, y: 0, w: 100, h: 40 }, b: { x: 1900, y: 0, w: 100, h: 40 }, c: { x: 1035, y: 57, w: 20, h: 40 } };
  const [arc] = route([{ id: 'e', from: 'a', to: 'b', around: 'below' }], long, new Set(), solid(long));
  assert.ok(!through(arc, long.c), `a long arc steps over a narrow box: ${arc.d}`);
});

test('an elbow to a box on the left keeps clear of boxes and points at the target', () => {
  const back = {
    a: { x: 300, y: 0, w: 100, h: 40 },
    b: { x: 0, y: 200, w: 100, h: 40 },
    c: { x: 280, y: 100, w: 140, h: 40 },
    d: { x: 60, y: 60, w: 80, h: 100 },
  };
  const [elbow] = route([{ id: 'e', from: 'a', to: 'b', elbow: true }], back, new Set(), solid(back));
  assert.ok(!through(elbow, back.c) && !through(elbow, back.d), `an elbow to a box on the left: ${elbow.d}`);
  const line = elbow.elbow!;
  assert.ok(line[0].x === back.a.x && line[line.length - 1].x === back.b.x + back.b.w, `the arrow points at the target: ${elbow.d}`);
});

test('a plain edge with spread anchors does not draw a curve through a box in its row', () => {
  const grid = {
    a: { x: 24, y: 39, w: 100, h: 90 },
    c: { x: 456, y: 80, w: 100, h: 38 },
    b: { x: 600, y: 74, w: 100, h: 90 },
    f: { x: 600, y: 176, w: 100, h: 120 },
    g: { x: 600, y: 308, w: 100, h: 120 },
  };
  const [e] = route(
    [
      { id: 'e', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'g' },
    ],
    grid,
    new Set(),
    solid(grid),
  );
  assert.ok(!through(e, grid.c), `a curve through a box: ${e.d}`);
});
