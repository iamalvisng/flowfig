import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, checkScene, checkTheme, contrast } from './check.ts';
import type { FlowProps } from './model.ts';
import type { Scene, SceneBox } from './scene.ts';
import type { Pt } from './geometry.ts';

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

test('a measured width wins over the estimate', () => {
  const s = scene({ boxes: [box('a', 0, 0, 100, 40, [{ text: 'x', fontSize: 14, room: 84, need: 90 }])] });
  assert.deepEqual(rules(checkScene(s)), ['text-overflow']);
});

test('an edge through a box it does not connect is an error; its own ends are not', () => {
  const boxes = [box('a', 0, 0), box('m', 200, 0), box('b', 400, 0)];
  const through = scene({ boxes, edges: [{ id: 'ab', from: 'a', to: 'b', curve: line(100, 20, 400, 20) }] });
  assert.deepEqual(rules(checkScene(through)), ['edge-crosses-box']);
  // The same ends, but the control points lift the curve over box m.
  const over: [Pt, Pt, Pt, Pt] = [
    { x: 100, y: 20 },
    { x: 100, y: -80 },
    { x: 400, y: -80 },
    { x: 400, y: 20 },
  ];
  assert.deepEqual(checkScene(scene({ boxes, edges: [{ id: 'ab', from: 'a', to: 'b', curve: over }] })), []);
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
  const f = checkTheme({ muted: '#bbbbbb' });
  // muted fails on bg and on the tint
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
});
