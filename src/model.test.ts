import { textWidth } from './text.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf,
  timelineLayout,
  timelineBeats,
  counts,
  TL_DIAMOND,
  TL_MIN_BAR,
  laneColumns,
  beatMs,
  decisions,
  edgeId,
  groupGap,
  isRows,
  nodes,
  readMs,
  toBeat,
} from './model.ts';
import type { FlowProps } from './model.ts';

test('toBeat reads every way a beat can be written', () => {
  assert.deepEqual(toBeat('a->b'), { hops: [{ edge: 'a->b', back: false }] });
  assert.deepEqual(toBeat(['x', { edge: 'y', back: true }]), {
    hops: [
      { edge: 'x', back: false },
      { edge: 'y', back: true },
    ],
  });
  // A hop object is a hop, not a beat, even though both are objects.
  assert.deepEqual(toBeat({ edge: 'x', data: 'chip' }), { hops: [{ edge: 'x', back: false, data: 'chip' }] });
  // A beat keeps its other fields; no edges is a pause.
  assert.deepEqual(toBeat({ say: 'hold', show: { box: 'filled' }, ms: 900 }), {
    say: 'hold',
    show: { box: 'filled' },
    ms: 900,
    hops: [],
  });
});

test('isRows tells row cards from other content', () => {
  assert.equal(isRows([{ text: 'a' }, { tag: 'order', text: 'b' }]), true);
  assert.equal(isRows(['plain', 'strings']), false);
  assert.equal(isRows('text'), false);
  assert.equal(isRows(null), false);
});

test('edges get a default id; decisions are found in nested groups', () => {
  assert.equal(edgeId({ from: 'a', to: 'b' }), 'a->b');
  assert.equal(edgeId({ id: 'call', from: 'a', to: 'b' }), 'call');
  const layout = {
    children: [{ id: 'a', label: 'A' }, { children: [{ id: 'd', label: 'D', shape: 'decision' as const }] }],
  };
  assert.deepEqual(decisions(layout), ['d']);
});

test('nodes lists every box in nested groups, not the groups', () => {
  const ids = nodes({
    children: [
      { id: 'a', label: 'A' },
      { id: 'g', children: [{ id: 'b', label: 'B' }] },
    ],
  }).map((n) => n.id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('toBeat keeps async on a hop', () => {
  const b = toBeat({ edges: [{ edge: 'w', async: true }, 'r'] });
  assert.equal(b.hops[0].async, true);
  assert.equal(b.hops[1].async, undefined);
});

test('a row gap grows to hold the widest edge label between two of its children', () => {
  const row = {
    children: [
      { id: 'a', label: 'A' },
      { id: 'g', children: [{ id: 'b', label: 'B' }] },
    ],
  };
  assert.equal(groupGap(row, []), 56);
  assert.equal(groupGap(row, [{ from: 'a', to: 'b', label: 'x' }]), 56);
  const long = 'a-long-monospace-label';
  assert.ok(groupGap(row, [{ from: 'a', to: 'b', label: long }]) >= long.length * 11 * 0.6 + 14 + 16 - 0.1);
  assert.equal(groupGap({ ...row, gap: 40 }, [{ from: 'a', to: 'b', label: long }]), 40, 'a set gap stays as set');
  assert.equal(groupGap({ ...row, direction: 'column' }, [{ from: 'a', to: 'b', label: long }]), 28);
});

test('readMs counts 500 ms plus 300 ms per word', () => {
  assert.equal(readMs(undefined), 0);
  assert.equal(readMs(''), 0);
  assert.equal(readMs('one'), 640);
  assert.equal(readMs('a b c d e f g h i j'), 2800);
});

test('beatMs gives an explicit ms as written', () => {
  const say = 'a b c d e f g h i j';
  assert.equal(beatMs({ hops: [] }, 900), 900);
  assert.equal(beatMs({ hops: [], say }, 900), 900 + 2800);
  assert.equal(beatMs({ hops: [], say, ms: 5000 }, 900), 5000);
  assert.equal(beatMs({ hops: [], say, ms: 100 }, 900), 100);
});

const lanesFig: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          { id: 'ask', label: 'Request refund' },
          { id: 'get', label: 'Get money' },
        ],
      },
      {
        label: 'Support',
        children: [
          { id: 'check', label: 'Check order' },
          { id: 'reject', label: 'Reject' },
        ],
      },
      {
        label: 'Finance',
        children: [
          { id: 'pay', label: 'Issue refund' },
          { id: 'audit', label: 'Audit', at: 1 },
        ],
      },
    ],
  },
  edges: [
    { id: 'a', from: 'ask', to: 'check' },
    { id: 'b', from: 'check', to: 'pay' },
    { id: 'c', from: 'pay', to: 'get' },
    { id: 'r', from: 'check', to: 'reject' },
  ],
  steps: [
    { label: 'ok', flow: ['a', 'b', { edge: 'c', back: true }] },
    { label: 'no', flow: ['a', 'r'] },
  ],
};

test('laneColumns gives each box its first appearance in the steps, back hops to-first, then the rest, then at', () => {
  const cols = laneColumns(lanesFig);
  // a: ask(0) check(1); b: pay(2); c back: get(3) then pay (seen); step no: reject(4); audit is in no step: 5, but at=1 wins
  assert.deepEqual(Object.fromEntries(cols), { ask: 0, check: 1, pay: 2, get: 3, reject: 4, audit: 1 });
});

const tl = (items: Record<string, unknown>[][], extra: Partial<FlowProps> = {}): FlowProps => ({
  timeline: true,
  layout: {
    direction: 'column',
    children: items.map((t, i) => ({ label: `T${i}`, children: t.map((n) => ({ label: String(n.id), ...n })) as never })),
  },
  edges: [],
  ...extra,
});
// 2026-10-05 is a Monday, 2026-10-11 a Sunday.
const oct = tl([[{ id: 'a', from: '2026-10-07', to: '2026-10-20' }]]);

test('dayOf reads real ISO dates only', () => {
  assert.equal(dayOf('1970-01-01'), 0);
  assert.equal(dayOf('1970-01-11'), 10);
  assert.equal(dayOf('2026-02-29'), null);
  assert.equal(dayOf('2026-02-30'), null);
  assert.equal(dayOf('2026-2-3'), null);
  assert.equal(dayOf('soon'), null);
  assert.equal(dayOf('2026-13-01'), null);
});

test('timelineLayout rounds the range to Monday and Sunday, and places bars', () => {
  const l = timelineLayout(oct, 300);
  assert.equal(l.start, dayOf('2026-10-05'));
  assert.equal(l.end, dayOf('2026-10-25'));
  // 21 days in 300 px.
  const day = 300 / 21;
  assert.ok(Math.abs(l.items[0].x - 2 * day) < 1e-9);
  assert.ok(Math.abs(l.items[0].w - 14 * day) < 1e-9);
  assert.deepEqual(l.rows, [1]);
  assert.deepEqual(
    l.ticks.map((t) => t.label),
    ['W41', 'W42', 'W43'],
  );
  assert.equal(l.ticks[0].x, 0);
});

test('the week tick follows ISO 8601 at a year boundary', () => {
  // 2026-01-01 is a Thursday, so the week of Monday 2025-12-29 is W1 of 2026.
  const l = timelineLayout(tl([[{ id: 'a', from: '2025-12-30', to: '2026-01-02' }]]), 100);
  assert.equal(l.ticks[0].label, 'W1');
});

test('a range over 16 weeks has month ticks', () => {
  const l = timelineLayout(tl([[{ id: 'a', from: '2026-10-05', to: '2027-05-03' }]]), 600);
  assert.deepEqual(
    l.ticks.slice(0, 3).map((t) => t.label),
    ['Nov', 'Dec', 'Jan'],
  );
  assert.ok(l.ticks.every((t) => t.x > 0));
});

test('a short bar gets the least width; a milestone is a diamond centered on its day', () => {
  const l = timelineLayout(
    tl([
      [
        { id: 'a', from: '2026-10-05', to: '2026-10-05' },
        { id: 'm', from: '2026-10-07' },
        { id: 'z', from: '2026-11-30', to: '2026-12-06' },
      ],
    ]),
    700,
  );
  assert.equal(l.items[0].w, TL_MIN_BAR);
  const m = l.items[1];
  assert.equal(m.milestone, true);
  assert.equal(m.w, TL_DIAMOND);
  assert.ok(Math.abs(m.x + TL_DIAMOND / 2 - (2 * 700) / 63) < 1e-9);
});

test('two overlapping bars stack; a bar that starts the day the other ends stacks too; a later bar reuses row 0', () => {
  const l = timelineLayout(
    tl([
      [
        { id: 'a', from: '2026-10-05', to: '2026-10-09' },
        { id: 'b', from: '2026-10-09', to: '2026-10-12' },
        { id: 'c', from: '2026-10-13', to: '2026-10-14' },
      ],
    ]),
    600,
  );
  assert.deepEqual(
    l.items.map((i) => i.row),
    [0, 1, 0],
  );
  assert.deepEqual(l.rows, [2]);
});

test('today is the x of its date and grows the range on both sides', () => {
  const at = (today: string) => timelineLayout({ ...oct, today }, 210);
  assert.equal(at('2026-10-05').today, 0);
  const before = at('2026-09-20');
  assert.equal(before.start, dayOf('2026-09-14'));
  assert.equal(before.today, ((dayOf('2026-09-20')! - before.start) / (before.end - before.start + 1)) * 210);
  assert.equal(at('2026-11-10').end, dayOf('2026-11-15'));
  // No today: no marker. The playhead rests at the last date.
  assert.equal(timelineLayout(oct, 210).today, null);
  assert.ok(Math.abs(timelineLayout(oct, 210).last! - 15 * 10) < 1e-9);
});

test('one item, or every item on one day, gives a one-week range with finite numbers', () => {
  for (const f of [
    tl([[{ id: 'a', from: '2026-10-07' }]]),
    tl([
      [
        { id: 'a', from: '2026-10-07', to: '2026-10-07' },
        { id: 'b', from: '2026-10-07' },
      ],
    ]),
  ]) {
    const l = timelineLayout(f, 350);
    assert.equal(l.end - l.start, 6);
    assert.deepEqual(
      l.ticks.map((t) => t.label),
      ['W41'],
    );
    for (const n of [l.last!, ...l.items.flatMap((i) => [i.x, i.w])]) assert.ok(Number.isFinite(n));
  }
});

test('a figure with no dated item has an empty layout and a null today', () => {
  const l = timelineLayout(tl([[{ id: 'a' }, { id: 'b', from: 'x' }]]), 300);
  assert.deepEqual(l.items, []);
  assert.equal(l.today, null);
  assert.ok(Number.isFinite(l.start) && Number.isFinite(l.end));
});

test('an item with a bad from is left out of the layout and the beats', () => {
  const f = tl([[{ id: 'a', from: '2026-02-30' }, { id: 'b', from: '2026-10-07' }, { id: 'c' }]]);
  assert.deepEqual(
    timelineLayout(f, 300).items.map((i) => i.id),
    ['b'],
  );
  assert.deepEqual(timelineBeats(f)[0].flow, [{ focus: ['b'], light: ['b'], say: 'b, 7 Oct' }]);
});

test('timelineBeats has one beat per item in date order, saying the label, the dates and the sub', () => {
  const f = tl([
    [{ id: 'a', from: '2026-10-09', to: '2026-10-10' }],
    [
      { id: 'b', from: '2026-10-05', sub: 'kickoff' },
      { id: 'c', from: '2026-10-09' },
    ],
  ]);
  const [step] = timelineBeats(f);
  assert.equal(step.label, 'timeline');
  assert.deepEqual(step.flow, [
    { focus: ['b'], light: ['b'], say: 'b, 5 Oct · kickoff' },
    { focus: ['a'], light: ['b', 'a'], say: 'a, 9 Oct to 10 Oct' },
    { focus: ['c'], light: ['b', 'a', 'c'], say: 'c, 9 Oct' },
  ]);
});

test('a label beside a bar takes room: a milestone the next day gets a second row; a far item shares the row', () => {
  const l = timelineLayout(
    tl([
      [
        { id: 'Kickoff', from: '2026-10-05', to: '2026-10-05' },
        { id: 'm', from: '2026-10-06' },
        { id: 'z', from: '2026-11-30' },
      ],
    ]),
    700,
  );
  assert.deepEqual(
    l.items.map((i) => [i.row, i.labelInside]),
    [
      [0, false],
      [1, false],
      [0, false],
    ],
  );
  // Two items share a row only when their spans (label included) are 8 px apart.
  const end = (i: (typeof l.items)[number]) => i.x + i.w + 6 + textWidth(i.id, 13);
  assert.ok(l.items[2].x >= end(l.items[0]) + 8);
});

test('counts reads the synthetic step of a timeline with no steps', () => {
  const c = counts(tl([[{ id: 'a', from: '2026-10-05', to: '2026-10-09' }]]));
  assert.deepEqual([c.steps, c.messages], [1, 0]);
});
