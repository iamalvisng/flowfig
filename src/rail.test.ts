import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutRail, railState, RAIL } from './rail.ts';
import type { FlowProps } from './model.ts';

const fig: FlowProps = {
  rail: true,
  layout: {
    children: [
      { id: 'browser', label: 'Browser' },
      {
        id: 'svc',
        label: 'Order service',
        children: [
          { id: 'orders', label: 'Orders' },
          { id: 'db', label: 'DB', shape: 'store' },
        ],
      },
      { id: 'idle', label: 'Idle' },
      { id: 'pay', label: 'Payments' },
    ],
  },
  edges: [
    { id: 'post', from: 'browser', to: 'orders', label: 'POST /checkout' },
    { id: 'charge', from: 'orders', to: 'pay' },
    { id: 'insert', from: 'orders', to: 'db', label: 'INSERT' },
    { id: 'hook', from: 'pay', to: 'orders' },
  ],
  steps: [
    { label: 'submit', flow: ['post'] },
    { label: 'pay', flow: [[{ edge: 'charge', data: 'charge $42.00' }, 'insert'], { edges: { edge: 'hook', async: true, data: 'paid' } }] },
  ],
};

test('columns follow the layout order, and boxes no hop uses get none', () => {
  const r = layoutRail(fig, 0)!;
  assert.deepEqual(
    r.columns.map((c) => c.id),
    ['browser', 'orders', 'db', 'pay'],
  );
  assert.ok(r.columns.every((c) => c.w >= RAIL.minCol));
});

test('a labeled group that holds columns draws a band', () => {
  const r = layoutRail(fig, 0)!;
  assert.deepEqual(
    r.bands.map((b) => b.label),
    ['Order service'],
  );
  const [orders, db] = [r.columns[1], r.columns[2]];
  const { x, w } = r.bands[0].rect;
  assert.ok(Math.abs(x - (orders.x - orders.w / 2 + RAIL.bandInset)) < 0.01 && Math.abs(x + w - (db.x + db.w / 2 - RAIL.bandInset)) < 0.01);
});

test('two adjacent bands keep at least 16 px between them', () => {
  const two: FlowProps = {
    ...fig,
    layout: {
      children: [...fig.layout.children.slice(0, 3), { id: 'billing', label: 'Billing', children: [{ id: 'pay', label: 'Payments' }] }],
    },
  };
  const [svc, billing] = layoutRail(two, 0)!.bands.map((b) => b.rect);
  assert.ok(billing.x - (svc.x + svc.w) >= 16);
});

test('no band border comes within 12 px of a phase label or a counter', () => {
  // The first and the last column sit in a band, so the columns must move in to clear the label and the counter.
  const edge: FlowProps = {
    ...fig,
    layout: {
      children: [
        { id: 'front', label: 'Front', children: [{ id: 'browser', label: 'Browser' }] },
        { id: 'orders', label: 'Orders' },
        { id: 'back', label: 'Back', children: [{ id: 'pay', label: 'Payments' }] },
      ],
    },
    edges: [fig.edges[0], fig.edges[1]],
    steps: [{ label: 'a long phase label', flow: ['post', 'charge'] }],
  };
  const r = layoutRail(edge, 600)!;
  const phase = r.rows[0].kind === 'phase' ? r.rows[0] : assert.fail();
  const borders = r.bands.flatMap((b) => [b.rect.x, b.rect.x + b.rect.w]);
  assert.ok(Math.min(...borders) >= phase.line.open - 0.01, 'the left border clears the label');
  assert.ok(Math.max(...borders) <= phase.line.end + 0.01, 'the right border clears the counter');
});

test('messages count over all steps; parallel hops share a group; async and payloads carry through', () => {
  const r = layoutRail(fig, 0)!;
  const msgs = r.rows.filter((row) => row.kind === 'message');
  assert.equal(r.total, 4);
  assert.deepEqual(
    msgs.map((m) => m.n),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    msgs.map((m) => m.text),
    ['POST /checkout', 'charge $42.00', 'INSERT', 'paid'],
  );
  assert.deepEqual(r.groups, [{ step: 1, rows: [r.rows.indexOf(msgs[1]), r.rows.indexOf(msgs[2])] }]);
  assert.equal(msgs[3].async, true);
});

test('back reverses the arrow', () => {
  const r = layoutRail({ ...fig, steps: [{ label: 's', flow: [{ edges: { edge: 'post', back: true } }] }] }, 0)!;
  const m = r.rows.find((row) => row.kind === 'message')!;
  assert.equal(m.kind === 'message' && r.columns[m.from].id, 'orders');
  assert.equal(m.kind === 'message' && r.columns[m.to].id, 'browser');
});

test('a hop with no data and no edge label draws no pill; an unknown edge is skipped', () => {
  const r = layoutRail({ ...fig, steps: [{ label: 's', flow: ['charge', 'nope'] }] }, 0)!;
  const msgs = r.rows.filter((row) => row.kind === 'message');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind === 'message' && msgs[0].pill, undefined);
});

test('an edge to a group gets a column with the group label', () => {
  const r = layoutRail({ ...fig, edges: [{ id: 'g', from: 'browser', to: 'svc' }], steps: [{ label: 's', flow: ['g'] }] }, 0)!;
  assert.deepEqual(
    r.columns.map((c) => c.label),
    ['Browser', 'Order service'],
  );
});

test('no hop, no rail', () => {
  assert.equal(layoutRail({ ...fig, steps: [] }, 0), null);
});

test('a rail narrower than the map is centered in the map width', () => {
  const r = layoutRail(fig, 2000)!;
  assert.equal(r.width, 2000);
  const left = r.columns[0].x - r.columns[0].w / 2;
  const right = r.width - (r.columns.at(-1)!.x + r.columns.at(-1)!.w / 2);
  assert.ok(Math.abs(left - right) < 0.01);
});

test('up to 10 messages nothing folds; above 10 only the playing step is open, and the height never changes', () => {
  assert.equal(layoutRail(fig, 0)!.folds, false);
  const many: FlowProps = {
    ...fig,
    steps: [
      { label: 'a', flow: Array(6).fill('post') },
      { label: 'b', flow: Array(6).fill('insert') },
    ],
  };
  const r = layoutRail(many, 0)!;
  assert.equal(r.folds, true);
  const open0 = railState(r, 0),
    open1 = railState(r, 1);
  const shown = (s: typeof open0, step: number) =>
    r.rows.filter((row, i) => row.kind === 'message' && row.step === step && s[i].shown).length;
  assert.equal(shown(open0, 0), 6);
  assert.equal(shown(open0, 1), 0);
  assert.equal(shown(open1, 1), 6);
  const bottom = (s: typeof open0) => Math.max(...s.filter((x) => x.shown).map((x) => x.y));
  assert.ok(r.height >= bottom(open0) + RAIL.row && r.height >= bottom(open1) + RAIL.row);
});

test('a hop on an edge whose end is not in the layout is skipped', () => {
  const r = layoutRail(
    { ...fig, edges: [...fig.edges, { id: 'ghost', from: 'browser', to: 'nowhere' }], steps: [{ label: 's', flow: ['ghost', 'post'] }] },
    0,
  )!;
  assert.deepEqual(
    r.rows.filter((row) => row.kind === 'message').map((m) => m.kind === 'message' && m.edge),
    ['post'],
  );
  assert.ok(!r.columns.some((c) => c.id === 'nowhere'));
});

test('a nested band label sits one label line below its parent, and the rows start below both', async () => {
  const { textWidth } = await import('./text.ts');
  const nested: FlowProps = {
    ...fig,
    layout: {
      children: [
        { id: 'browser', label: 'Browser' },
        {
          label: 'Backend',
          children: [
            { label: 'API tier', children: [{ id: 'orders', label: 'Orders' }] },
            { id: 'db', label: 'DB', shape: 'store' },
          ],
        },
        { id: 'pay', label: 'Payments' },
      ],
    },
    edges: [fig.edges[0], fig.edges[2], fig.edges[1]],
    steps: [{ label: 's', flow: ['post', 'insert', 'charge'] }],
  };
  const r = layoutRail(nested, 0)!;
  const [outer, inner] = r.bands;
  assert.deepEqual([outer.label, inner.label], ['Backend', 'API tier']);
  // A label is drawn at rect.x + 10, rect.y + 14, 11 px high (x measured at the .04em spacing).
  const box = (b: (typeof r.bands)[number]) => ({
    x: b.rect.x + 10,
    w: textWidth(b.label.toUpperCase(), 11, true) + 0.04 * 11 * b.label.length,
    y: b.rect.y + 14 - 11,
    h: 14,
  });
  const [a, b] = [box(outer), box(inner)];
  const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  assert.ok(apart, 'the two band label boxes do not overlap');
  assert.equal(inner.rect.y - outer.rect.y, RAIL.band);
  assert.ok(r.head >= inner.rect.y + RAIL.band + RAIL.cols, 'the first row starts below both label lines and the column labels');
});
