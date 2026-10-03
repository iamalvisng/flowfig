// Two faults a grader found in agent figures (eval-M): text past the outline of a diamond, and a stub line across an edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, render } from './svg.ts';
import { checkScene } from './check.ts';
import { crosses, type Pt } from './geometry.ts';
import { diamondLines, diamondRoom, lanePlan, STUB_ROOM, tightCopies, type FlowProps } from './model.ts';
import { textWidth } from './text.ts';

// M1: the stub pill "from Refund payment" sat at the top left of the Support band, and its stub ran across "Rejected: damaged -> Reply".
const m1: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          { id: 'open', label: 'Open a return', sub: 'within 30 days of delivery', at: 0 },
          { id: 'ship', label: 'Ship the item', sub: 'with the label, within 14 days', at: 3 },
          { id: 'reply', label: 'Reply', sub: 'within 7 days', at: 7 },
        ],
      },
      {
        label: 'Support agent',
        children: [
          { id: 'review', label: 'Review the request', sub: 'delivery date and reason', shape: 'decision', at: 1 },
          { id: 'label', label: 'Send the label', sub: 'prepaid label by email', at: 2 },
          { id: 'rejlate', label: 'Rejected: late', sub: 'emails the reason', at: 3, tone: 'red' },
          { id: 'rejdmg', label: 'Rejected: damaged', sub: 'emails the reason', at: 6, tone: 'red' },
          { id: 'close', label: 'Close the ticket', sub: 'confirmation email', at: 7, tone: 'green' },
        ],
      },
      {
        label: 'Warehouse',
        children: [
          { id: 'inspect', label: 'Inspect the item', sub: 'within 2 working days of arrival', shape: 'decision', at: 4 },
          { id: 'back', label: 'Ship it back', sub: 'damaged item', at: 7 },
        ],
      },
      { label: 'Finance', children: [{ id: 'refund', label: 'Refund payment', sub: 'within 3 working days', at: 5 }] },
    ],
  },
  edges: [
    { id: 'e1', from: 'open', to: 'review' },
    { id: 'e2', from: 'review', to: 'label', label: 'in time' },
    { id: 'e3', from: 'label', to: 'ship' },
    { id: 'e4', from: 'ship', to: 'inspect' },
    { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
    { id: 'e6', from: 'refund', to: 'close' },
    { id: 'r1', from: 'review', to: 'rejlate', label: 'late' },
    { id: 'r2', from: 'rejlate', to: 'reply', around: 'above' },
    { id: 'r3', from: 'inspect', to: 'rejdmg', label: 'damaged' },
    { id: 'r4', from: 'rejdmg', to: 'reply' },
    { id: 'r5', from: 'rejdmg', to: 'back' },
  ],
  steps: [
    { label: 'Accepted', flow: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] },
    { label: 'Late request', flow: ['e1', 'r1', 'r2'] },
    { label: 'Damaged item', flow: ['e1', 'e2', 'e3', 'e4', 'r3', ['r4', 'r5']] },
  ],
};

const diamond = (label: string, sub?: string): FlowProps => ({
  layout: { direction: 'row', children: [{ id: 'd', label, sub, shape: 'decision' }] },
  edges: [],
});

test('M1: no place in the Support band avoids the edge, so the lane grows and the pill sits under its box with no crossing', () => {
  assert.deepEqual(check(m1), []);
  // The copy of the Support lane (101 px with one box row, index 1) in block 2 grew by STUB_ROOM: the plan has not marked it, a tight stub did.
  assert.ok(!lanePlan(m1).tall.has('1@2'));
  const bands = render(m1).scene.lanes!.filter((l) => l.id === 'Support agent');
  assert.equal(bands.at(-1)!.rect.h, 101 + STUB_ROOM);
});

test('tightCopies names the lane copy of each tight stub end', () => {
  const lanes = [
    { id: 'a', label: 'A', children: [{ id: 'x', label: 'X' }] },
    { id: 'b', label: 'B', children: [{ id: 'y', label: 'Y' }] },
  ];
  const ends = new Map<string, [number, number]>([['e', [0, 1]]]);
  const edges = [{ id: 'e', from: 'x', to: 'y' }];
  const tight = (t: [boolean, boolean]) => [...tightCopies(lanes, ends, edges, [{ id: 'e', stub: { tight: t } }])];
  assert.deepEqual(tight([true, false]), ['0@0']);
  assert.deepEqual(tight([false, true]), ['1@1']);
  assert.deepEqual(tight([false, false]), []);
});

test('M2: the sub of a diamond wraps inside the outline, and check reports no overflow', () => {
  const fig = diamond('In 30 days?', 'Checks delivery date and reason');
  assert.equal(check(fig).length, 0);
  const w = 100 + 70;
  const d = diamondLines(fig.layout.children[0] as never, w);
  assert.ok(d.subs.length >= 2, 'the sub wraps');
  for (const l of [d.label, ...d.subs]) assert.ok(d.subs.length && true && l.far < d.h / 2);
  for (const l of d.subs) assert.ok(textWidth(l.text, 12) <= diamondRoom(w, d.h, l.far) + 0.5, l.text);
  // The old room was the box width, 100 px: the one-line sub (about 175 px) crossed the outline.
  assert.ok(textWidth('Checks delivery date and reason', 12) > diamondRoom(w, 77, 16));
});

test('a diamond whose text fits keeps its size and one line', () => {
  const d = diamondLines({ id: 'd', label: 'Late?', sub: 'in 2 days', shape: 'decision' }, 170);
  assert.equal(d.subs.length, 1);
  assert.equal(d.h, 77);
  assert.equal(diamondLines({ id: 'd', label: 'Late?', shape: 'decision' }, 170).h, 62);
});

test('the SVG diamond is as tall as diamondLines says', () => {
  const fig = diamond('In 30 days?', 'Checks delivery date and reason');
  const item = fig.layout.children[0] as never;
  const pts = render(fig)
    .svg.match(/<polygon points="([^"]+)"/)![1]
    .split(' ')
    .map((p) => p.split(',').map(Number));
  const h = diamondLines(item, Math.round(pts[1][0] - pts[3][0])).h;
  assert.equal(Math.round(pts[2][1] - pts[0][1]), h);
});

test('check reports a text line that passes the outline of a diamond', () => {
  const s = {
    width: 600,
    minFont: 11,
    edges: [],
    boxes: [
      { id: 'd', rect: { x: 0, y: 0, w: 170, h: 77 }, texts: [{ text: 'wide', fontSize: 12, need: 160, room: diamondRoom(170, 77, 16) }] },
    ],
  };
  assert.deepEqual(
    checkScene(s).map((f) => f.rule),
    ['text-overflow'],
  );
});

test('check reports a stub line across the path of another edge', () => {
  const at = (x: number, y: number): Pt => ({ x, y });
  const line = (a: Pt, b: Pt): [Pt, Pt, Pt, Pt] => [a, a, b, b];
  const base = { width: 600, minFont: 11, boxes: [] };
  const stub = { id: 's', from: 'a', to: 'b', curve: line(at(100, 25), at(112, 25)), pts: [at(100, 25), at(130, 25)] };
  const across = { id: 'e', from: 'c', to: 'd', curve: line(at(115, -50), at(115, 99)) };
  const apart = { id: 'e', from: 'c', to: 'd', curve: line(at(150, -50), at(150, 99)) };
  assert.deepEqual(
    checkScene({ ...base, edges: [stub, across] }).map((f) => f.rule),
    ['stub-crosses-edge'],
  );
  assert.deepEqual(checkScene({ ...base, edges: [stub, apart] }), []);
  assert.ok(crosses(at(0, 0), at(10, 0), at(5, -5), at(5, 5)));
  assert.ok(!crosses(at(0, 0), at(10, 0), at(0, -5), at(0, 5)), 'a touch at the end does not count');
});
