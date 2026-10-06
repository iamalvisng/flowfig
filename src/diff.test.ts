import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, formatDiff, mergeFigures } from './diff.ts';
import { checkSpec } from './check.ts';
import { nodes, TONES, type FigNode, type FlowProps } from './model.ts';
import { toSvg } from './svg.ts';

const base: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'API', sub: 'v1' },
      { id: 'c', label: 'DB' },
    ],
  },
  edges: [
    { id: 'q', from: 'a', to: 'b', label: 'GET' },
    { from: 'b', to: 'c' },
  ],
  steps: [
    { label: 'read', flow: ['q', 'b->c', { edge: 'q', back: true, data: '200' }] },
    { label: 'old', flow: ['q'] },
  ],
};

test('diff finds boxes, edges, steps, messages and the rail', () => {
  const next: FlowProps = {
    rail: true,
    layout: {
      children: [
        { id: 'a', label: 'Browser' },
        { id: 'b', label: 'API', sub: 'v1' },
        { id: 'd', label: 'Cache' },
      ],
    },
    edges: [
      { id: 'q', from: 'a', to: 'b', label: 'POST', source: 'x.ts' },
      { from: 'b', to: 'd' },
    ],
    steps: [
      { label: 'read', flow: ['q', 'b->d', { edge: 'q', back: true, data: '201' }] },
      { label: 'new', flow: ['q'] },
    ],
  };
  assert.deepEqual(diff(base, next), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'label "Client" -> "Browser"' },
    { kind: 'box', op: 'removed', id: 'c' },
    { kind: 'box', op: 'added', id: 'd' },
    { kind: 'edge', op: 'changed', id: 'q', detail: 'label "GET" -> "POST"; source (none) -> "x.ts"' },
    { kind: 'edge', op: 'removed', id: 'b->c' },
    { kind: 'edge', op: 'added', id: 'b->d' },
    { kind: 'step', op: 'removed', id: 'old' },
    { kind: 'step', op: 'added', id: 'new' },
    { kind: 'message', op: 'removed', id: 'read: b->c' },
    { kind: 'message', op: 'removed', id: 'read: q back "200"' },
    { kind: 'message', op: 'removed', id: 'old: q' },
    { kind: 'message', op: 'added', id: 'read: b->d' },
    { kind: 'message', op: 'added', id: 'read: q back "201"' },
    { kind: 'message', op: 'added', id: 'new: q' },
    { kind: 'rail', op: 'changed', id: 'rail', detail: '(none) -> true' },
  ]);
});

test('a box that moves to another group is a change', () => {
  const a = { id: 'a', label: 'A' };
  const b = { id: 'b', label: 'B' };
  const at = (children: FlowProps['layout']['children']): FlowProps => ({ layout: { children }, edges: [{ from: 'a', to: 'b' }] });
  assert.deepEqual(diff(at([a, { label: 'Zone', children: [b] }]), at([{ label: 'Zone', children: [a, b] }])), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'group (none) -> "Zone"' },
  ]);
});

test('a hop tone and a box tone are changes', () => {
  const toned: FlowProps = {
    ...base,
    layout: { children: [{ id: 'a', label: 'Client', tone: 'red' }, ...base.layout.children.slice(1)] },
    steps: [{ label: 'read', flow: ['q', 'b->c', { edge: 'q', back: true, data: '200', tone: 'green' }] }, base.steps![1]],
  };
  assert.deepEqual(diff(base, toned), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'tone (none) -> "red"' },
    { kind: 'message', op: 'removed', id: 'read: q back "200"' },
    { kind: 'message', op: 'added', id: 'read: q back "200" [green]' },
  ]);
});

test('a from or to change is a box change', () => {
  const a: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-05', to: '2026-10-09' }] }, edges: [] };
  const b: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-06', to: '2026-10-09' }] }, edges: [] };
  assert.deepEqual(diff(a, b), [{ kind: 'box', op: 'changed', id: 'x', detail: 'from "2026-10-05" -> "2026-10-06"' }]);
  const c: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-05' }] }, edges: [] };
  assert.equal(diff(a, c)[0].detail, 'to "2026-10-09" -> (none)');
  const marked = structuredClone(base);
  (marked.layout as { children: { mark?: string }[] }).children[0].mark = 'start';
  const out = diff(base, marked);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'box');
});

test('diff reports a via change, a removed repeated hop and a caption change', () => {
  const base: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'q', from: 'a', to: 'b', via: 'order-paid' }],
    steps: [{ label: 'pay', caption: 'The order is paid.', flow: ['q', 'q'] }],
  };
  const next: FlowProps = {
    ...base,
    edges: [{ id: 'q', from: 'a', to: 'b', via: 'order-shipped' }],
    steps: [{ label: 'pay', caption: 'The order ships.', flow: ['q'] }],
  };
  const lines = formatDiff(diff(base, next), 'text');
  assert.match(lines, /edge changed: q \(via "order-paid" -> "order-shipped"\)/);
  assert.match(lines, /message removed/);
  assert.match(lines, /step changed: pay \(caption/);
});

const labels = (g: FlowProps['layout']): string[] => g.children.flatMap((c) => ('children' in c ? [`[${labels(c).join(' ')}]`] : [c.id]));

test('a removed box goes after its surviving old sibling, in the same group', () => {
  const box = (id: string) => ({ id, label: id });
  const old: FlowProps = {
    layout: { children: [box('a'), { label: 'Zone', children: [box('b'), box('x'), box('c')] }, box('d')] },
    edges: [],
  };
  const next: FlowProps = { layout: { children: [box('a'), { label: 'Zone', children: [box('b'), box('c')] }, box('d')] }, edges: [] };
  const { figure, marks } = mergeFigures(old, next);
  assert.deepEqual(labels(figure.layout), ['a', '[b x c]', 'd']);
  assert.deepEqual(marks.boxes, { x: 'removed' });
});

test('in an auto figure a removed box goes into its surviving old frame', () => {
  const box = (id: string) => ({ id, label: id });
  const old: FlowProps = { layout: { auto: true, children: [box('a'), { label: 'Zone', children: [box('b'), box('x')] }] }, edges: [] };
  const next: FlowProps = { layout: { auto: true, children: [box('a'), { label: 'Zone', children: [box('b')] }] }, edges: [] };
  assert.deepEqual(labels(mergeFigures(old, next).figure.layout), ['a', '[b x]']);
});

test('an edge that keeps its id and gets new ends becomes a removed and an added edge', () => {
  const box = (id: string) => ({ id, label: id });
  const layout = { children: [box('a'), box('b'), box('c')] };
  const { figure, marks } = mergeFigures(
    { layout, edges: [{ id: 'e', from: 'a', to: 'b' }] },
    { layout, edges: [{ id: 'e', from: 'a', to: 'c' }] },
  );
  assert.deepEqual(marks.edges, { e: 'added', 'e (old)': 'removed' });
  assert.equal(
    checkSpec(figure).some((f) => f.rule === 'duplicate-id'),
    false,
  );
});

test('the diff SVG draws an added edge green, a removed edge red and dashed, and an unchanged edge muted', () => {
  const box = (id: string) => ({ id, label: id });
  const layout = { children: [box('a'), box('b'), box('c')] };
  const old: FlowProps = {
    layout,
    edges: [
      { id: 'keep', from: 'a', to: 'b' },
      { id: 'gone', from: 'b', to: 'c' },
    ],
  };
  const next: FlowProps = {
    layout,
    edges: [
      { id: 'keep', from: 'a', to: 'b' },
      { id: 'new', from: 'a', to: 'c' },
    ],
  };
  const { figure, marks } = mergeFigures(old, next);
  const svg = toSvg(figure, { marks });
  const stroke = (id: string) => svg.match(new RegExp(`<path id="p-${id}"[^>]*stroke="([^"]+)"`))![1];
  assert.equal(stroke('new'), TONES.green);
  assert.equal(stroke('gone'), TONES.red);
  assert.equal(stroke('keep'), 'var(--muted)');
  assert.match(svg, /<g opacity="0.5" stroke-dasharray="5 4"><path id="p-gone"/);
});

test('a removed top-level box in an auto figure is placed and does not throw', () => {
  const box = (id: string) => ({ id, label: id });
  const { figure } = mergeFigures(
    { layout: { auto: true, children: [box('a'), box('x')] }, edges: [] },
    { layout: { auto: true, children: [box('a'), box('b')] }, edges: [] },
  );
  assert.deepEqual(labels(figure.layout), ['a', 'b', 'x']);
});

test('a removed box beside an unlabeled row goes after the row, not inside it', () => {
  const box = (id: string) => ({ id, label: id });
  const row = { direction: 'row' as const, children: [box('a'), box('b')] };
  const { figure } = mergeFigures({ layout: { children: [row, box('x')] }, edges: [] }, { layout: { children: [row] }, edges: [] });
  assert.deepEqual(labels(figure.layout), ['[a b]', 'x']);
});

test('a lanes diff keeps the time columns that the steps gave, so the figure stays in one block', () => {
  const lane = (label: string, ...ids: string[]) => ({ label, children: ids.map((id) => ({ id, label: id })) });
  const next: FlowProps = {
    lanes: true,
    layout: { direction: 'column', children: [lane('One', 'a'), lane('Two', 'b')] },
    edges: [{ id: 'e', from: 'b', to: 'a' }],
    steps: [{ label: 's', flow: ['e'] }],
  };
  const { figure } = mergeFigures({ ...next, layout: { direction: 'column', children: [lane('One', 'a', 'x'), lane('Two', 'b')] } }, next);
  const at = Object.fromEntries(nodes(figure.layout).map((n) => [n.id, n.at]));
  assert.deepEqual(at, { a: 1, b: 0, x: 2 });
});

test('a timeline diff SVG is still', () => {
  const tl = (extra: FigNode[]): FlowProps => ({
    timeline: true,
    layout: {
      direction: 'column',
      children: [{ label: 'Product', children: [{ id: 'spec', label: 'Spec', from: '2026-10-05', to: '2026-10-16' }, ...extra] }],
    },
    edges: [],
  });
  const { figure, marks } = mergeFigures(tl([]), tl([{ id: 'b', label: 'Build', from: '2026-10-19', to: '2026-11-06' }]));
  assert.doesNotMatch(toSvg(figure, { marks }), /@keyframes/);
});

test('an edge with no label and a new source shows orange', () => {
  const layout = {
    children: [
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b' },
    ],
  };
  const { figure, marks } = mergeFigures(
    { layout, edges: [{ id: 'e', from: 'a', to: 'b' }] },
    { layout, edges: [{ id: 'e', from: 'a', to: 'b', source: 'x.ts' }] },
  );
  assert.match(toSvg(figure, { marks }), new RegExp(`<path id="p-e"[^>]*stroke="${TONES.orange}"`));
});
