import { textWidth } from './text.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitScale,
  narrowOf,
  nextWide,
  dayOf,
  timelineLayout,
  timelineBeats,
  counts,
  playheadItem,
  loopStartItem,
  TL_AXIS_W,
  TL_DIAMOND,
  TL_MIN_BAR,
  laneColumns,
  labelPillW,
  lanePlan,
  beatMs,
  groupGap,
  toBeat,
} from './model.ts';
import type { FigBeat, FigGroup, FigNode, FlowProps } from './model.ts';

test('each documented way to write a beat gives the same hops', () => {
  assert.deepEqual(toBeat('a->b'), { hops: [{ edge: 'a->b', back: false }] });
  assert.deepEqual(toBeat(['x', { edge: 'y', back: true }]), {
    hops: [
      { edge: 'x', back: false },
      { edge: 'y', back: true },
    ],
  });
  assert.deepEqual(toBeat({ edge: 'x', data: 'chip' }), { hops: [{ edge: 'x', back: false, data: 'chip' }] });
  assert.deepEqual(toBeat({ say: 'hold', show: { box: 'filled' }, ms: 900 }), {
    say: 'hold',
    show: { box: 'filled' },
    ms: 900,
    hops: [],
  });
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
  assert.equal(
    groupGap({ ...row, gap: 24 }, [{ from: 'a', to: 'b', label: 'ok' }]),
    labelPillW('ok') + 32,
    'a set gap grows to the label and a visible line on each side',
  );
  assert.equal(groupGap({ ...row, gap: 40 }, []), 40, 'a set gap stays when no labeled edge crosses');
  assert.ok(
    groupGap({ ...row, gap: 40 }, [{ from: 'a', to: 'b', label: long }]) >= long.length * 11 * 0.6 + 14 - 0.1,
    'a set gap grows to the label',
  );
  assert.equal(
    groupGap({ ...row, gap: 40 }, [{ from: 'a', to: 'b', label: long, around: 'below' }]),
    40,
    'an edge with around does not grow a set gap',
  );
  assert.equal(groupGap({ ...row, direction: 'column' }, []), 28);
  assert.ok(groupGap({ ...row, direction: 'column' }, [{ from: 'a', to: 'b', label: long }]) >= 18 + 32);
});

test('a beat with ms lasts that long, also when the caption needs more time', () => {
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

test('lanes: each box takes the time column of its first hop; at wins', () => {
  const cols = laneColumns(lanesFig);
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

test('a timeline range starts on a Monday and ends on a Sunday, and bars sit at their dates', () => {
  const l = timelineLayout(oct, 300);
  assert.equal(l.start, dayOf('2026-10-05'));
  assert.equal(l.end, dayOf('2026-10-25'));
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
  // ISO week 1 of 2026 starts Monday 2025-12-29, because 2026-01-01 is a Thursday.
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

test('a timeline with no steps plays one beat per item in date order', () => {
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
  const end = (i: (typeof l.items)[number]) => i.x + i.w + 6 + textWidth(i.id, 13);
  assert.ok(l.items[2].x >= end(l.items[0]) + 8);
});

test('the figure line counts the one synthetic step of a timeline', () => {
  const c = counts(tl([[{ id: 'a', from: '2026-10-05', to: '2026-10-09' }]]));
  assert.deepEqual([c.steps, c.messages], [1, 0]);
});

test('the playhead goes to the first dated focus id; a beat with no focus keeps it', () => {
  const items = [{ id: 'invoice' }, { id: 'ga' }];
  const beats = [{ focus: ['nope', 'ga', 'invoice'] }, {}, { focus: ['invoice'] }, { say: 'x' }];
  assert.equal(playheadItem(items, beats, 0)?.id, 'ga');
  assert.equal(playheadItem(items, beats, 1)?.id, 'ga');
  assert.equal(playheadItem(items, beats, 2)?.id, 'invoice');
  assert.equal(playheadItem(items, beats, 3)?.id, 'invoice');
  assert.equal(playheadItem(items, [{}], 0), undefined);
});

test('lanes wrap: a block holds the most columns that keep the text readable', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  assert.equal(lanePlan(demo.props).per, 4);
  assert.equal(lanePlan(demo.props, { width: 1400 }).per, 7);
  assert.equal(lanePlan(lanesFig, { width: 1200 }).per, Math.max(...laneColumns(lanesFig).values()) + 1);
});

test('lanes wrap: a cross-block edge gets its pill texts, and the gaps next to its ends grow into free room only', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  const plan = lanePlan(demo.props);
  assert.deepEqual(
    [...plan.stubs],
    [
      ['arrive', ['→ Inspect', 'from Ship item']],
      ['late', ['late → Rejected', 'from Review', '→ Rejected']],
    ],
  );
  assert.ok(plan.gaps[plan.cols.get('ship')!] > 18);
  assert.ok(plan.lead[1] > 0 && plan.lead[0] === 0);
  assert.equal(lanePlan(demo.props, { width: 1400 }).stubs.size, 0);
  assert.deepEqual(plan.starts, [0, 4, 7]);
});

test('lanes wrap: a diamond adds 70 px to its column, and a mono card row lowers the smallest font to 10.5 px', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  const diamond = structuredClone(demo.props);
  ((diamond.layout.children[1] as FigGroup).children[0] as FigNode).shape = 'decision';
  assert.deepEqual(lanePlan(demo.props, { width: 700 }).starts, [0, 4, 7]);
  assert.deepEqual(lanePlan(diamond, { width: 700 }).starts, [0, 3, 5, 7]);
  const card = (mono: boolean) => {
    const f = structuredClone(demo.props);
    (f.steps![0].flow[0] as FigBeat).show = { review: [{ text: 'x', mono }] };
    return lanePlan(f, { width: 1240 }).blocks.length;
  };
  assert.equal(card(false), 1);
  assert.equal(card(true), 2);
});

test('lanes wrap: a block holds 2 columns at least; if 2 do not fit, the lanes keep one block', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  assert.deepEqual(lanePlan(demo.props, { width: 600 }).starts, [0, 3, 5, 7]);
  const narrow = lanePlan(demo.props, { width: 200 });
  assert.deepEqual([narrow.blocks, narrow.starts], [[0], [0, 7]]);
});

test('lanes wrap: the block split does not depend on the pill texts', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  const withLabel = (label?: string) => ({
    ...demo.props,
    edges: demo.props.edges.map((e) => ({ ...e, label: ['arrive', 'late'].includes(e.id!) ? label : undefined })),
  });
  const long = lanePlan(withLabel('a very long edge label that makes the pill wider than any gap'));
  const none = lanePlan(withLabel());
  assert.deepEqual(long.starts, none.starts);
  assert.ok(labelPillW(long.stubs.get('late')![0]) > 300);
});

test('timeline: the loop starts with the playhead at the first beat item, not at the range end', async () => {
  const { default: demo } = await import('../figures/roadmap.ts');
  const lay = timelineLayout(demo.props, TL_AXIS_W);
  const first = loopStartItem(lay.items, timelineBeats(demo.props))!;
  assert.equal(first.id, 'invoice');
  assert.notEqual(first.x, lay.last);
  assert.equal(loopStartItem(lay.items, []), undefined, 'no step: the playhead stays at the range end');
});

test('narrow mode: the player folds below half scale, keeps the fold until the box holds half the wide map, draws the fold at full size, and resets on a new spec', () => {
  const run = (events: [number, { row: number; col: number }][]) => {
    let state = { wide: 0, of: [] as unknown[] };
    return events.map(([box, spec]) => {
      for (let i = 0; i < 3; i++) {
        const wide = narrowOf(state.wide, state.of, [spec]);
        const goal = nextWide(wide, box, wide ? spec.col : spec.row);
        const map = wide ? spec.col : spec.row;
        if (goal === wide) return `${map} at ${fitScale(wide, box, map).toFixed(2)}`;
        state = { wide: goal, of: [spec] };
      }
      assert.fail(`the layout toggles at ${box} px`);
    });
  };
  const a = { row: 1200, col: 264 },
    b = { row: 600, col: 250 };
  const boxes = [1100, 254, 700, 560, 420, 1100, 324];
  assert.deepEqual(run(boxes.map((w) => [w, a])), [
    '1200 at 0.92',
    '264 at 1.00',
    '1200 at 0.58',
    '264 at 1.00',
    '264 at 1.00',
    '1200 at 0.92',
    '264 at 1.00',
  ]);
  assert.deepEqual(
    run([
      [324, a],
      [500, b],
    ]),
    ['264 at 1.00', '600 at 0.83'],
  );
});
