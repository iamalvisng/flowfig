import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRendered, checkSpec, checkScene, checkTheme, contrast } from './check.ts';
import { isGroup, TONES, toneFill, type FigGroup, type FigNode, type FlowProps } from './model.ts';
import type { Finding, Scene, SceneBox } from './scene.ts';
import type { Pt } from './geometry.ts';
import { check, render } from './svg.ts';
import shop from '../figures/inside-shop.ts';
import { PLAIN_EXAMPLES } from './guide.ts';

const fig: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'A' },
      { id: 'g', label: 'G', children: [{ id: 'b', label: 'B' }] },
    ],
  },
  edges: [{ id: 'ab', from: 'a', to: 'b' }],
  steps: [{ label: 'go', flow: [{ edges: 'ab', show: { b: [{ text: 'x' }] }, light: ['a'] }] }],
};
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

test('a correct spec has no findings', () => {
  assert.deepEqual(checkSpec(fig), []);
});

test('an edge to a box that does not exist is an error', () => {
  const f = checkSpec({ ...fig, edges: [{ id: 'ax', from: 'a', to: 'x' }], steps: [] });
  assert.deepEqual(rules(f), ['unknown-id']);
  assert.equal(f[0].severity, 'error');
  assert.match(f[0].message, /"x"/);
});

test('a hop, show, light or nodes id that does not exist is an error', () => {
  const f = checkSpec({ ...fig, steps: [{ label: 's', nodes: ['n'], flow: [{ edges: 'zz', show: { y: 'text' }, light: ['q'] }] }] });
  assert.deepEqual(rules(f), ['unknown-id', 'unknown-id', 'unknown-id', 'unknown-id']);
});

test('two boxes with one id is an error', () => {
  const f = checkSpec({
    ...fig,
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A2' },
        { id: 'b', label: 'B' },
      ],
    },
  });
  assert.deepEqual(rules(f), ['duplicate-id']);
});

test('a step with no beats is a warning', () => {
  const f = checkSpec({ ...fig, steps: [{ label: 'empty', flow: [] }] });
  assert.deepEqual(rules(f), ['empty-step']);
  assert.equal(f[0].severity, 'warning');
});

const box = (id: string, x: number, y: number, w = 100, h = 40, texts: SceneBox['texts'] = []): SceneBox => ({
  id,
  rect: { x, y, w, h },
  texts,
});
const line = (x0: number, y0: number, x1: number, y1: number) =>
  [
    { x: x0, y: y0 },
    { x: x0, y: y0 },
    { x: x1, y: y1 },
    { x: x1, y: y1 },
  ] as [Pt, Pt, Pt, Pt];
const scene = (over: Partial<Scene>): Scene => ({ width: 600, boxes: [], edges: [], minFont: 11, ...over });

test('text that fits its box passes, text that does not is an error', () => {
  const ok = scene({ boxes: [box('a', 0, 0, 100, 40, [{ text: 'short', fontSize: 14, room: 84 }])] });
  assert.deepEqual(checkScene(ok), []);
  const long = scene({ boxes: [box('a', 0, 0, 100, 40, [{ text: 'a much longer label', fontSize: 14, room: 84 }])] });
  assert.deepEqual(rules(checkScene(long)), ['text-overflow']);
});

test('the auto option of check drops the "set auto" hint, as layout.auto does', () => {
  const s = scene({
    boxes: [box('a', 0, 0), box('m', 200, 0), box('b', 400, 0)],
    edges: [{ id: 'ab', from: 'a', to: 'b', curve: line(100, 20, 400, 20) }],
  });
  const hint = (opts: { auto?: boolean }) =>
    checkRendered(fig, opts, s)
      .find((f) => f.rule === 'edge-crosses-box')!
      .message.includes('"auto": true');
  assert.equal(hint({}), true);
  assert.equal(hint({ auto: true }), false);
});

test('a measured width wins over the estimate', () => {
  const s = scene({ boxes: [box('a', 0, 0, 100, 40, [{ text: 'x', fontSize: 14, room: 84, need: 90 }])] });
  assert.deepEqual(rules(checkScene(s)), ['text-overflow']);
});

test('an edge through a box it does not connect is an error; its own ends are not', () => {
  const boxes = [box('a', 0, 0), box('m', 200, 0), box('b', 400, 0)];
  const through = scene({ boxes, edges: [{ id: 'ab', from: 'a', to: 'b', curve: line(100, 20, 400, 20) }] });
  assert.deepEqual(rules(checkScene(through)), ['edge-crosses-box']);
  const behind = scene({ boxes, edges: [{ id: 'ab', from: 'a', to: 'b', curve: line(100, 20, 400, 20), behind: true }] });
  assert.deepEqual(checkScene(behind), [], 'an edge behind the boxes crosses none');
  const over: [Pt, Pt, Pt, Pt] = [
    { x: 100, y: 20 },
    { x: 100, y: -80 },
    { x: 400, y: -80 },
    { x: 400, y: 20 },
  ];
  assert.deepEqual(checkScene(scene({ boxes, edges: [{ id: 'ab', from: 'a', to: 'b', curve: over }] })), []);
});

test('a long curve through a short box is an error', () => {
  const curve: [Pt, Pt, Pt, Pt] = [
    { x: 528, y: 132 },
    { x: 528, y: 798 },
    { x: 400, y: 798 },
    { x: 400, y: 540 },
  ];
  const s = scene({ boxes: [box('m', 454, 248.5, 190, 53)], edges: [{ id: 'v', from: 'a', to: 'b', curve }] });
  assert.deepEqual(rules(checkScene(s).filter((f) => f.severity === 'error')), ['edge-crosses-box']);
});

test('an edge that touches a box corner by 3 px is not an error; an edge through the middle is', () => {
  const boxes = [box('m', 200, 0)];
  const corner = scene({ boxes, edges: [{ id: 'e', from: 'a', to: 'b', curve: line(150, 43, 203, 37) }] });
  assert.deepEqual(checkScene(corner), []);
  const middle = scene({ boxes, edges: [{ id: 'e', from: 'a', to: 'b', curve: line(150, 20, 350, 20) }] });
  assert.deepEqual(rules(checkScene(middle)), ['edge-crosses-box']);
});

test('an edge that arcs far past its ends is a long-edge warning; a direct edge is not', () => {
  const arc: [Pt, Pt, Pt, Pt] = [
    { x: 528, y: 42 },
    { x: 528, y: -392 },
    { x: 96, y: -392 },
    { x: 96, y: 559 },
  ];
  const found = checkScene(scene({ edges: [{ id: 'k', from: 'a', to: 'b', curve: arc }] }));
  assert.deepEqual(
    found.map((f) => [f.rule, f.severity, f.ids]),
    [['long-edge', 'warning', ['k']]],
  );
  assert.deepEqual(checkScene(scene({ edges: [{ id: 'd', from: 'a', to: 'b', curve: line(0, 0, 0, 700) }] })), []);
});

test('an edge label outside the drawn figure area is an error', () => {
  const edge = (x: number) => ({ id: 'e', from: 'a', to: 'b', curve: line(0, 300, 10, 300), label: { x, y: 200, w: 50, h: 18 } });
  const area = { x: 0, y: 0, w: 600, h: 400 };
  assert.deepEqual(rules(checkScene(scene({ area, edges: [edge(-20)] }))), ['label-overlap']);
  assert.deepEqual(checkScene(scene({ area, edges: [edge(0)] })), []);
});

test('labels that overlap each other or a box are errors; labels that only touch are not', () => {
  const edge = (id: string, x: number) => ({ id, from: 'a', to: 'b', curve: line(0, 300, 10, 300), label: { x, y: 200, w: 50, h: 18 } });
  assert.deepEqual(rules(checkScene(scene({ edges: [edge('e1', 0), edge('e2', 40)] }))), ['label-overlap']);
  assert.deepEqual(checkScene(scene({ edges: [edge('e1', 0), edge('e2', 50)] })), []);
  assert.deepEqual(rules(checkScene(scene({ boxes: [box('c', 30, 190)], edges: [edge('e1', 0)] }))), ['label-overlap']);
});

test('rail rows of two steps may share a place: the SVG never shows them together', () => {
  const row = (id: string, step: number) => ({
    id,
    from: 'a',
    to: 'b',
    curve: line(0, 300, 10, 300),
    label: { x: 0, y: 200, w: 50, h: 18 },
    step,
  });
  assert.deepEqual(checkScene(scene({ edges: [row('rail:1', 0), row('rail:8', 1)] })), []);
  assert.deepEqual(rules(checkScene(scene({ edges: [row('rail:1', 0), row('rail:2', 0)] }))), ['label-overlap']);
});

test('text that scales below the minimum at the target width is a warning', () => {
  assert.deepEqual(checkScene(scene({ width: 800, minFont: 10.5 })), []);
  const f = checkScene(scene({ width: 1200, minFont: 10.5 }));
  assert.deepEqual(rules(f), ['small-text']);
  assert.equal(f[0].severity, 'warning');
  assert.deepEqual(checkScene(scene({ width: 1200, minFont: 10.5 }), { width: 1400 }), []);
});

test('contrast reads hex, short hex, rgb and hsl', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#fff', 'rgb(0 0 0)'), 21);
  assert.equal(contrast('rgba(0, 0, 0, 1)', 'hsl(0, 0%, 100%)'), 21);
  assert.equal(contrast('var(--x)', '#fff'), null);
});

test('the built-in light and dark themes pass', () => {
  assert.deepEqual(checkTheme(), []);
  assert.deepEqual(checkTheme({ accent: undefined }), []);
});

test('a custom theme with low contrast is an error', () => {
  const f = checkTheme({ muted: '#bbbbbb' }).filter((x) => !/box tint/.test(x.message));
  assert.deepEqual(rules(f), ['low-contrast', 'low-contrast']);
  assert.match(f[0].message, /custom theme: muted on bg/);
});

test('a dark custom theme on a light surface gives low contrast on the active tint', () => {
  const f = checkTheme({ fg: '#ffffff', bg: '#111111', muted: '#dddddd', surface: '#eeeeee' });
  assert.ok(
    f.some((x) => x.rule === 'low-contrast' && /fg on tint/.test(x.message)),
    JSON.stringify(f),
  );
  assert.deepEqual(checkTheme(), []);
});

test('colors the rule cannot read and a custom font are warnings', () => {
  assert.deepEqual(rules(checkTheme({ bg: 'var(--page)', font: 'Inter' })), ['font-estimated', 'color-not-checked']);
});

test('a quiet edge that no beat uses is an error, and one that a beat uses is fine', () => {
  const quiet = { ...fig, edges: [...fig.edges, { id: 'q', from: 'a', to: 'b', quiet: true }] };
  const f = checkSpec(quiet);
  assert.deepEqual(rules(f), ['hidden-edge']);
  assert.equal(f[0].message, 'edge "q" is quiet and no beat uses it, so the figure never shows it');
  const used = { ...quiet, steps: [{ label: 'go', flow: [{ edges: ['ab', 'q'] }] }] };
  assert.deepEqual(checkSpec(used), []);
  assert.deepEqual(rules(checkSpec({ ...quiet, steps: undefined })), ['hidden-edge']);
});

test('a source with a bad form is a warning; a good one is not', () => {
  const bad = { ...fig, edges: [{ ...fig.edges[0], source: 'src/a.ts#' }] };
  assert.deepEqual(rules(checkSpec(bad)), ['bad-source']);
  const good = { ...fig, edges: [{ ...fig.edges[0], source: 'src/a.ts#f' }] };
  assert.deepEqual(checkSpec(good), []);
  for (const via of ['', 'a b']) assert.deepEqual(rules(checkSpec({ ...fig, edges: [{ ...fig.edges[0], via }] })), ['bad-source']);
});

test('white text on the fill of each tone has contrast 4.5:1', () => {
  for (const [name, c] of Object.entries(TONES)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const m = toneFill(c).match(/(\d+)%/)![1];
    const k = Number(m) / 100;
    const fill = `rgb(${r * k},${g * k},${b * k})`;
    assert.ok(contrast('#ffffff', fill)! >= 4.5, `${name} ${contrast('#ffffff', fill)}`);
  }
});

test('a custom muted color with low contrast on a tone tint is an error', () => {
  // #767676 has 4.54:1 on white, but less than 4.5:1 on the tint.
  const f = checkTheme({ muted: '#767676', surface: '#ffffff', bg: '#ffffff' });
  assert.ok(
    f.some((x) => x.rule === 'low-contrast' && /muted on the \w+ box tint/.test(x.message)),
    JSON.stringify(f),
  );
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

test('lanes need a column of labeled groups; two boxes of one lane in one column is a warning', () => {
  const row = { ...lanesFig, layout: { ...lanesFig.layout, direction: 'row' as const } };
  assert.deepEqual(rules(checkSpec(row)), ['lanes-need-column']);
  const nested = {
    ...lanesFig,
    layout: { direction: 'column' as const, children: [{ label: 'A', children: [{ label: 'B', children: [{ id: 'x', label: 'X' }] }] }] },
    edges: [],
    steps: [],
  };
  assert.deepEqual(rules(checkSpec(nested)), ['lanes-need-column']);
  const taken = {
    ...lanesFig,
    layout: {
      ...lanesFig.layout,
      children: [
        {
          label: 'One',
          children: [
            { id: 'p', label: 'P', at: 0 },
            { id: 'q', label: 'Q', at: 0 },
          ],
        },
      ],
    },
    edges: [],
    steps: [],
  };
  assert.deepEqual(rules(checkSpec(taken)), ['lane-column-taken']);
  assert.deepEqual(checkSpec(lanesFig), []);
});

test('lanes: a box at the top gives lanes-need-column, and bad-at gives an error', () => {
  const top = { ...lanesFig, layout: { direction: 'column' as const, children: [{ id: 'a', label: 'A' }] }, edges: [], steps: [] };
  assert.deepEqual(rules(checkSpec(top)), ['lanes-need-column']);
  for (const at of [-1, 0.5]) {
    const bad = {
      ...lanesFig,
      layout: { direction: 'column' as const, children: [{ label: 'One', children: [{ id: 'p', label: 'P', at }] }] },
    };
    assert.ok(rules(checkSpec({ ...bad, edges: [], steps: [] })).includes('bad-at'));
  }
});

test('mark-count: two starts and a start with no end are warnings; one start and two ends is not', () => {
  const withMarks = (...marks: ('start' | 'end' | undefined)[]): FlowProps => ({
    ...fig,
    layout: { children: marks.map((mark, i) => ({ id: `n${i}`, label: 'N', mark })) },
    edges: [],
    steps: [],
  });
  const count = (f: FlowProps) => checkSpec(f).filter((x) => x.rule === 'mark-count');
  assert.equal(count(withMarks('start', 'start', 'end'))[0].message, 'a lifecycle has one start and at least one end: 2 start, 1 end');
  assert.equal(count(withMarks('start', undefined))[0].severity, 'warning');
  assert.deepEqual(count(withMarks('start', 'end', 'end')), []);
});

const tlFig = (n: Record<string, unknown>, extra: Partial<FlowProps> = {}): FlowProps => ({
  timeline: true,
  layout: {
    direction: 'column',
    children: [{ label: 'Track', children: [{ id: 'a', label: 'A', from: '2026-10-05', to: '2026-10-09', ...n }] }],
  },
  edges: [],
  ...extra,
});

test('a correct timeline has no findings', () => {
  assert.deepEqual(checkSpec(tlFig({}, { today: '2026-10-07' })), []);
});

test('bad-date: not a date, a date that does not exist, to before from, a bad today', () => {
  for (const n of [
    { from: 'soon' },
    { from: '2026-02-30' },
    { from: '2026-02-29' },
    { from: '2026-13-01' },
    { from: '2026-2-3' },
    { to: 'x' },
    { to: '2026-10-01' },
  ])
    assert.deepEqual(rules(checkSpec(tlFig(n))), ['bad-date'], JSON.stringify(n));
  assert.deepEqual(rules(checkSpec(tlFig({}, { today: '10/07' }))), ['bad-date']);
});

test('timeline-need-from: a box with no from is an error', () => {
  const f = checkSpec(tlFig({ from: undefined, to: undefined }));
  assert.deepEqual(rules(f), ['timeline-need-from']);
  assert.deepEqual(f[0].ids, ['a']);
});

test('a timeline needs the lanes layout, and the message names both', () => {
  const f = checkSpec({ ...tlFig({}), layout: { direction: 'row', children: [{ id: 'a', label: 'A', from: '2026-10-05' }] } });
  assert.deepEqual(rules(f), ['lanes-need-column']);
  assert.match(f[0].message, /lanes/);
  assert.match(f[0].message, /timeline/);
});

test('timeline and lanes together is a warning', () => {
  const f = checkSpec(tlFig({}, { lanes: true }));
  assert.deepEqual(rules(f), ['timeline-and-lanes']);
  assert.equal(f[0].severity, 'warning');
});

test('timeline-dependency-order: an item that starts on or before its source end is a warning', () => {
  const two = (from: string): FlowProps => ({
    timeline: true,
    layout: {
      direction: 'column',
      children: [
        {
          label: 'T',
          children: [
            { id: 'a', label: 'A', from: '2026-10-05', to: '2026-10-09' },
            { id: 'b', label: 'B', from, to: '2026-10-20' },
          ],
        },
      ],
    },
    edges: [{ from: 'a', to: 'b' }],
  });
  const f = checkSpec(two('2026-10-08'));
  assert.deepEqual(rules(f), ['timeline-dependency-order']);
  assert.equal(f[0].severity, 'warning');
  assert.equal(f[0].message, '"b" does not start after "a" ends');
  assert.deepEqual(rules(checkSpec(two('2026-10-09'))), ['timeline-dependency-order']);
  assert.deepEqual(checkSpec(two('2026-10-10')), []);
  assert.deepEqual(checkSpec(two('2026-10-12')), []);
});

test('timeline-dependency-order: an item may start on the day of the milestone it depends on', () => {
  const fig: FlowProps = {
    timeline: true,
    layout: {
      direction: 'column',
      children: [
        {
          label: 'T',
          children: [
            { id: 'm', label: 'Freeze', from: '2026-10-05' },
            { id: 'b', label: 'Bug bash', from: '2026-10-05', to: '2026-10-09' },
          ],
        },
      ],
    },
    edges: [{ from: 'm', to: 'b' }],
  };
  assert.deepEqual(checkSpec(fig), []);
});

test('an unknown focus id is an unknown-id error', () => {
  const f = checkSpec({ ...tlFig({}), steps: [{ label: 's', flow: [{ focus: ['nope'] }] }] });
  assert.deepEqual(rules(f), ['unknown-id']);
  assert.deepEqual(f[0].ids, ['nope']);
});

test('a stub line through a box is edge-crosses-box; an edge through a stub pill is label-overlap', () => {
  const box = (id: string, x: number, y: number): SceneBox => ({ id, rect: { x, y, w: 100, h: 40 }, texts: [] });
  const p = (x: number, y: number): Pt => ({ x, y });
  const base: Scene = { width: 600, minFont: 12, boxes: [box('a', 0, 0), box('b', 300, 0), box('c', 150, 200)], edges: [] };
  const stub = { id: 's', from: 'a', to: 'b', curve: [p(100, 20), p(100, 20), p(100, 20), p(100, 20)] as [Pt, Pt, Pt, Pt] };
  const rules = (s: Scene) => checkScene(s).map((f) => f.rule);
  assert.deepEqual(rules({ ...base, edges: [{ ...stub, pts: [p(100, 20), p(200, 20), p(200, 260)] }] }), ['edge-crosses-box']);
  const pill = { x: 112, y: 100, w: 60, h: 18 };
  const e = { id: 'e', from: 'a', to: 'b', curve: [p(50, 109), p(150, 109), p(250, 109), p(350, 109)] as [Pt, Pt, Pt, Pt] };
  const found = checkScene({ ...base, edges: [{ ...stub, pts: [p(100, 20), p(112, 109)], label: pill }, e] });
  assert.deepEqual(
    found.map((f) => [f.rule, f.ids]),
    [['label-overlap', ['e', 's']]],
  );
});

test('a pill or an edge label across a lane border is label-overlap', () => {
  const p = (x: number, y: number): Pt => ({ x, y });
  const lane = { id: 'Support', rect: { x: 0, y: 0, w: 400, h: 100 } };
  const stub = (y: number) => ({
    id: 's',
    from: 'a',
    to: 'b',
    curve: [p(0, 0), p(0, 0), p(0, 0), p(0, 0)] as [Pt, Pt, Pt, Pt],
    pts: [p(100, y), p(112, y)],
    label: { x: 112, y: y - 9, w: 60, h: 18 },
  });
  const scene = (y: number): Scene => ({ width: 400, minFont: 12, boxes: [], edges: [stub(y)], lanes: [lane] });
  assert.deepEqual(checkScene(scene(50)), []);
  assert.deepEqual(
    checkScene(scene(98)).map((f) => [f.rule, f.message]),
    [['label-overlap', 'the pill of edge "s" crosses the border of lane "Support"']],
  );
  const labeled: Scene = {
    width: 400,
    minFont: 12,
    boxes: [],
    edges: [{ id: 'e', from: 'a', to: 'b', curve: [p(0, 0), p(0, 0), p(0, 0), p(0, 0)], label: { x: 100, y: 91, w: 50, h: 18 } }],
    lanes: [lane, { id: 'Billing', rect: { x: 0, y: 100, w: 400, h: 100 } }],
  };
  assert.deepEqual(
    checkScene(labeled).map((f) => f.message),
    ['the label of edge "e" crosses the border of lane "Support"', 'the label of edge "e" crosses the border of lane "Billing"'],
  );
});

test('a timeline elbow through a box it does not connect is edge-crosses-box', () => {
  const box = (id: string, x: number, y: number): SceneBox => ({ id, rect: { x, y, w: 100, h: 40 }, texts: [] });
  const p = (x: number, y: number): Pt => ({ x, y });
  const boxes = [box('a', 0, 0), box('b', 300, 200), box('c', 150, 100)];
  const curve = [p(100, 20), p(200, 20), p(200, 220), p(300, 220)] as [Pt, Pt, Pt, Pt];
  const edge = { id: 'e', from: 'a', to: 'b', curve, behind: true as const };
  const found = (e: Scene['edges'][0]) => checkScene({ width: 600, minFont: 12, boxes, edges: [e] }).map((f) => [f.rule, f.ids]);
  assert.deepEqual(found({ ...edge, elbow: [...curve] }), [['edge-crosses-box', ['e', 'c']]]);
  assert.deepEqual(found(edge), [], 'a behind edge with no corners is skipped');
  assert.deepEqual(found({ ...edge, elbow: [p(100, 20), p(120, 20), p(120, 220), p(300, 220)] }), []);
});

test('two edge labels from one box that would overlap each other move apart', () => {
  const fig: FlowProps = {
    layout: {
      direction: 'column',
      children: [
        { direction: 'row', children: [{ id: 'a', label: 'A' }] },
        {
          direction: 'row',
          children: [
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
        },
      ],
    },
    edges: [
      { from: 'a', to: 'b', label: 'check password hash' },
      { from: 'a', to: 'c', label: 'session id' },
    ],
  };
  const { scene } = render(fig);
  assert.deepEqual(
    checkScene(scene).filter((f) => f.rule === 'label-overlap'),
    [],
  );
});

test('two labeled edges down to the next row get a row gap that holds both labels', () => {
  const fig: FlowProps = {
    layout: {
      direction: 'column',
      children: [
        { direction: 'row', children: [{ id: 'a', label: 'A' }] },
        {
          direction: 'row',
          children: [
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
        },
      ],
    },
    edges: [
      { from: 'a', to: 'b', label: 'check the password' },
      { from: 'a', to: 'c', label: 'send session id' },
    ],
  };
  assert.deepEqual(
    checkScene(render(fig).scene).filter((f) => f.rule === 'label-overlap'),
    [],
  );
});

test('plain-text warns on code-shaped labels, long lines, filler words and code names in sentences', () => {
  const spec: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'findUserByEmail', source: 'src/u.ts#findUserByEmail' },
        { id: 'b', label: 'Redis' },
        { id: 'c', label: 'Check input' },
        { id: 'd', label: 'Find user', source: 'src/u.ts#findUser' },
        { id: 'e', label: 'GitHub' },
        { id: 'f', label: 'DynamoDB', source: 'src/db.ts#saveOrder' },
        { id: 'g', label: 'ReportsController', source: 'src/reports.ts#ReportsController' },
        { id: 'h', label: 'sweep', source: 'src/jobs.ts#sweep' },
        { id: 'i', label: 'user.findById' },
        { id: 'j', label: 'req.userId' },
        { id: 'k', label: 'src/loginHandler.ts' },
        { id: 'l', label: 'SELECT' },
      ],
    },
    edges: [
      { id: 'e3', from: 'a', to: 'l', label: 'SET sess: EX 3600' },
      { id: 'e4', from: 'l', to: 'a', label: 'GET /user' },
      { id: 'e1', from: 'a', to: 'b', label: 'seamless sync' },
      { id: 'e2', from: 'c', to: 'd', label: 'session id' },
    ],
    steps: [
      {
        label: 'login',
        flow: [
          { edges: 'e1', say: 'validate_rows returns the good rows' },
          { edges: 'e2', say: 'The gateway calls auth' },
          { edges: 'e2', say: 'user.findById reads the row' },
          { edges: 'e2', say: 'send magic link' },
          { edges: 'e2', say: 'word '.repeat(21).trim() },
        ],
      },
    ],
  };
  const msgs = checkSpec(spec)
    .filter((f) => f.rule === 'plain-text')
    .map((f) => f.message)
    .join('\n');
  assert.match(msgs, /label "findUserByEmail" looks like code; use plain words, the code name goes in source/);
  assert.match(msgs, /label "seamless sync" has the filler word "seamless"/);
  assert.match(msgs, /say 1 has the code name "validate_rows"; use plain words/);
  assert.match(msgs, /say 5 has 21 words; keep it to 20/);
  assert.match(msgs, /label "ReportsController" looks like code/);
  assert.match(msgs, /say 3 has the code name "user.findById"/);
  assert.match(msgs, /label "user.findById" looks like code/);
  assert.match(msgs, /label "req.userId" looks like code/);
  assert.match(msgs, /label "src\/loginHandler.ts" looks like code/);
  assert.match(msgs, /label "SELECT" looks like code/);
  assert.match(msgs, /label "SET sess: EX 3600" looks like code/);
  assert.doesNotMatch(msgs, /GET \/user/);
  assert.doesNotMatch(msgs, /Redis|Check input|Find user|session id|The gateway calls auth|GitHub|DynamoDB|sweep|send magic link/);
});

test('each good plain-text example in the guide passes, and each checked bad example warns', () => {
  const warns = (field: string, text: string, symbol: string) => {
    const box = { id: 'a', label: field === 'label' ? text : 'A', sub: field === 'sub' ? text : undefined, source: `src/x.ts#${symbol}` };
    const hop = { edge: 'e', data: field === 'data' ? text : undefined };
    const spec: FlowProps = {
      layout: { children: [box, { id: 'b', label: 'B' }] },
      edges: [{ id: 'e', from: 'a', to: 'b', label: field === 'edge' ? text : 'send' }],
      steps: [{ label: field === 'step' ? text : 'Send', flow: [{ edges: hop, say: field === 'say' ? text : 'A sends.' }] }],
    };
    return checkSpec(spec).some((f) => f.rule === 'plain-text');
  };
  for (const x of PLAIN_EXAMPLES) {
    assert.equal(warns(x.field, x.good, x.bad), false, x.good);
    if (!x.style) assert.equal(warns(x.field, x.bad, x.bad), true, x.bad);
  }
});

test('a detail that is not a relative .svg path is a warning', () => {
  const box = (detail: string): FlowProps => ({ layout: { children: [{ id: 'a', label: 'A', detail }] }, edges: [] });
  for (const bad of ['docs/a.png', '/abs/a.svg', 'https://x.test/a.svg']) assert.deepEqual(rules(checkSpec(box(bad))), ['bad-detail'], bad);
  assert.deepEqual(checkSpec(box('docs/flows/a.svg')), []);
});

test('an empty group does not break the layout of the other boxes', () => {
  for (const auto of [undefined, true] as const) {
    const spec: FlowProps = {
      layout: {
        auto,
        direction: 'column',
        children: [
          { id: 'g', label: 'Empty', children: [] },
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
      edges: [{ from: 'a', to: 'b' }],
    };
    const { svg, scene } = render(spec);
    assert.doesNotMatch(svg, /NaN/);
    assert.deepEqual(
      checkScene(scene, {}).filter((f) => f.severity === 'error'),
      [],
    );
  }
});

test('an edge to a group with no boxes fails check --strict', () => {
  const spec = {
    layout: {
      children: [
        { id: 'g', children: [] },
        { id: 'a', label: 'A' },
      ],
    },
    edges: [{ from: 'a', to: 'g' }],
  };
  const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');
  const r = spawnSync(process.execPath, [cli, 'check', '-', '--strict'], { input: JSON.stringify(spec), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /edge "a->g" ends at group "g", which has no boxes/);
});

const shopFig = shop.props as FlowProps;
const find = (g: FigGroup, id: string): FigNode | undefined => {
  for (const c of g.children) {
    const n = isGroup(c) ? find(c, id) : c.id === id ? c : c.inside && find(c.inside.layout, id);
    if (n) return n;
  }
};
const edit = (fig: FlowProps, id: string, change: (n: FigNode) => void): FlowProps => {
  const f = structuredClone(fig);
  change(find(f.layout, id)!);
  return f;
};
const more = (n: FigNode, count: number) =>
  n.inside!.layout.children.push(
    ...Array.from({ length: count }, (_, i) => ({
      id: `${n.id}-extra-${i}`,
      label: `Extra ${i}`,
      source: `examples/shop/extra.ts#extra${i}`,
    })),
  );

test('each Inside rule fires on its fault and stays quiet on a figure with three levels', () => {
  assert.deepEqual(check(shopFig), []);
  const cases: [string, FlowProps, Partial<Finding> & { scene?: string }][] = [
    [
      'an inside edge from a box that is no neighbor',
      edit(shopFig, 'orders', (n) => n.inside!.edges!.push({ from: 'browser', to: 'validate' })),
      {
        rule: 'part-edge-mismatch',
        severity: 'error',
        scene: 'Orders',
        message: 'edge "browser->validate" comes in from "browser", but no edge goes from "browser" to "orders"',
      },
    ],
    [
      'an inside edge with no part at either end',
      edit(shopFig, 'orders', (n) => n.inside!.edges!.push({ from: 'gateway', to: 'payments' })),
      {
        rule: 'part-edge-mismatch',
        severity: 'error',
        scene: 'Orders',
        message: 'edge "gateway->payments" has no part at either end',
      },
    ],
    [
      'an outer edge that no inside edge continues',
      edit(shopFig, 'mail', (n) => {
        n.inside!.edges = n.inside!.edges!.filter((e) => e.from !== 'payments');
        n.inside!.steps![0].flow = n.inside!.steps![0].flow.slice(1);
      }),
      {
        rule: 'part-edge-mismatch',
        severity: 'warning',
        scene: 'Mail',
        message:
          'edge "payments->mail" comes in, but no edge inside "mail" starts at "payments"; the open view cannot show where the flow comes in',
      },
    ],
    [
      'a part with no source',
      edit(shopFig, 'save', (n) => delete n.source),
      { rule: 'part-no-source', severity: 'warning', scene: 'Orders', message: 'part "save" has no source' },
    ],
    [
      'a box with 17 parts',
      edit(shopFig, 'orders', (n) => more(n, 12)),
      { rule: 'part-limit', severity: 'error', message: 'box "orders" has 17 parts; the limit is 16' },
    ],
    [
      'a figure with 61 parts',
      edit(
        edit(shopFig, 'mail', (n) => more(n, 12)),
        'cart',
        (n) => more(n, 9),
      ),
      { rule: 'part-limit', severity: 'error', message: 'the figure has 61 parts; the limit is 60' },
    ],
    [
      'a part at level 4',
      edit(shopFig, 'read-token', (n) => {
        n.inside = { layout: { children: [{ id: 'deep', label: 'Deep', source: 'examples/shop/auth.ts#deep' }] } };
      }),
      { rule: 'part-limit', severity: 'error', ids: ['read-token'] },
    ],
    [
      'an inside with no parts',
      edit(shopFig, 'mail', (n) => {
        n.inside = { layout: { children: [] } };
      }),
      { rule: 'part-limit', severity: 'error', message: 'box "mail": inside has no parts' },
    ],
    [
      'an inside in a lanes figure',
      {
        lanes: true,
        layout: {
          direction: 'column',
          children: [
            {
              id: 'shop',
              label: 'Shop',
              children: [
                { id: 'gateway', label: 'Gateway' },
                {
                  id: 'orders',
                  label: 'Orders',
                  inside: { layout: { children: [{ id: 'save', label: 'Save', source: 'examples/shop/orders.ts#save' }] } },
                },
              ],
            },
          ],
        },
        edges: [{ from: 'gateway', to: 'orders' }],
      },
      {
        rule: 'parts-ignored',
        severity: 'warning',
        message: 'the figure sets lanes; lanes do not open boxes, so the renderers ignore inside on "orders"',
      },
    ],
  ];
  for (const [fault, fig, want] of cases) {
    const found = checkSpec(fig);
    assert.ok(
      found.some((f) => Object.entries(want).every(([k, v]) => JSON.stringify(f[k as keyof typeof f]) === JSON.stringify(v))),
      `${fault}: ${JSON.stringify(found)}`,
    );
  }
});

test('duplicate-id fires on one id at two levels and names both paths', () => {
  const twice = edit(shopFig, 'validate', (n) =>
    n.inside!.layout.children.push({ id: 'route', label: 'Route', source: 'examples/shop/validate.ts#route' }),
  );
  const f = checkSpec(twice).filter((x) => x.rule === 'duplicate-id');
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].severity, 'error');
  assert.ok(/\bGateway\b/.test(f[0].message) && f[0].message.includes('Orders > Check the cart'), f[0].message);
});

test('a bad source on a level 3 part gives one finding with the full level path', () => {
  const bad = edit(shopFig, 'read-token', (n) => (n.source = 'auth.ts#read token'));
  const f = checkSpec(bad).filter((x) => x.rule === 'bad-source');
  assert.deepEqual(
    f.map((x) => x.message),
    ['part "read-token" [Gateway > Sign in]: source "auth.ts#read token" is not path or path#symbol'],
  );
});

test('small-text on an inner level uses the width of the widest level, because the image scales as one', () => {
  const step = (i: number) => ({ id: `step-${i}`, label: `Step ${i}`, source: `examples/shop/orders.ts#step${i}` });
  const wide: FlowProps = {
    layout: {
      children: [
        { id: 'gateway', label: 'Gateway', source: 'examples/shop/gateway.ts#checkout' },
        {
          direction: 'column',
          children: [
            {
              id: 'orders',
              label: 'Orders',
              source: 'examples/shop/orders.ts#createOrder',
              inside: {
                layout: { children: Array.from({ length: 16 }, (_, i) => step(i)) },
                edges: Array.from({ length: 16 }, (_, i) => ({ from: i ? `step-${i - 1}` : 'gateway', to: `step-${i}` })),
              },
            },
            {
              id: 'mail',
              label: 'Mail',
              source: 'examples/shop/mail.ts#sendReceipt',
              inside: {
                layout: {
                  children: [
                    { id: 'queue', label: 'Queue', source: 'examples/shop/mail.ts#queue' },
                    { id: 'send', label: 'Send', source: 'examples/shop/mail.ts#send' },
                  ],
                },
                edges: [
                  { from: 'gateway', to: 'queue' },
                  { from: 'queue', to: 'send' },
                ],
              },
            },
          ],
        },
      ],
    },
    edges: [
      { from: 'gateway', to: 'orders' },
      { from: 'gateway', to: 'mail' },
    ],
  };
  const small = (f: Finding[]) => f.filter((x) => x.rule === 'small-text').map((x) => x.scene);
  assert.ok(small(check(wide)).includes('Mail'), JSON.stringify(check(wide)));
  assert.deepEqual(small(check(wide, { scene: 'mail' })), []);
});
