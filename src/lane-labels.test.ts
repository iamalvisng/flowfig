// An edge label of a lanes figure sits inside one lane band, 4 px from the border (the stub pills of wrapped lanes already did).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, render } from './svg.ts';
import { checkScene } from './check.ts';
import type { FlowProps } from './model.ts';
import type { Scene } from './scene.ts';

const lanesFig: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          { id: 'a', label: 'Ask', at: 0 },
          { id: 'd', label: 'Done', at: 6 },
        ],
      },
      { label: 'Support', children: [{ id: 'b', label: 'Review', at: 3 }] },
    ],
  },
  edges: [
    { from: 'a', to: 'b', label: 'ticket' },
    { from: 'b', to: 'd', label: 'paid' },
  ],
};

// Two next columns: the gap is shorter than the label, so the label moves up into its band at the middle x.
const tightFig: FlowProps = {
  ...lanesFig,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          { id: 'a', label: 'Ask', at: 0 },
          { id: 'd', label: 'Done', at: 2 },
        ],
      },
      { label: 'Support', children: [{ id: 'b', label: 'Review', at: 1 }] },
    ],
  },
};

for (const [name, fig] of [
  ['a wide gap', lanesFig],
  ['a tight gap', tightFig],
] as const)
  test(`lanes: a cross-lane edge places its label inside one lane band, with ${name}`, () => {
    const { scene } = render(fig);
    assert.equal(scene.lanes?.length, 2);
    for (const e of scene.edges) {
      const p = e.label!;
      assert.ok(
        scene.lanes!.some(
          (l) => p.x >= l.rect.x + 4 && p.x + p.w <= l.rect.x + l.rect.w - 4 && p.y >= l.rect.y + 4 && p.y + p.h <= l.rect.y + l.rect.h - 4,
        ),
        `label of ${e.id} is inside a band`,
      );
    }
    assert.deepEqual(
      check(lanesFig).filter((f) => f.rule === 'label-overlap'),
      [],
    );
  });

test('checkScene: an edge label across a lane border is label-overlap', () => {
  const pt = { x: 0, y: 0 };
  const scene: Scene = {
    width: 400,
    minFont: 12,
    boxes: [],
    edges: [{ id: 'e', from: 'a', to: 'b', curve: [pt, pt, pt, pt], label: { x: 100, y: 91, w: 50, h: 18 } }],
    lanes: [
      { id: 'Support', rect: { x: 0, y: 0, w: 400, h: 100 } },
      { id: 'Billing', rect: { x: 0, y: 100, w: 400, h: 100 } },
    ],
  };
  assert.deepEqual(
    checkScene(scene).map((f) => f.message),
    ['the label of edge "e" crosses the border of lane "Support"', 'the label of edge "e" crosses the border of lane "Billing"'],
  );
});

test('a figure without lanes keeps its label at the middle of the edge', () => {
  const fig: FlowProps = {
    layout: {
      direction: 'row',
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ from: 'a', to: 'b', label: 'go' }],
  };
  const { scene } = render(fig);
  const [s, , , e] = scene.edges[0].curve;
  const l = scene.edges[0].label!;
  assert.equal(scene.lanes, undefined);
  assert.ok(Math.abs(l.x + l.w / 2 - (s.x + e.x) / 2) < 0.01 && Math.abs(l.y + 9 - (s.y + e.y) / 2) < 0.01);
});
