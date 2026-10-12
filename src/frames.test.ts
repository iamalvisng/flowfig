import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyFrames, sheetGrid } from './frames.ts';
import { beatTimes, toBeat, type FlowProps } from './model.ts';
import { toSvg } from './svg.ts';

const ONE: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'Server', shape: 'store' },
    ],
  },
  edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
  steps: [{ label: 'write', flow: [{ edges: 'w', say: 'The client writes a row.' }] }],
};
const kinds = (fig: FlowProps, o: { fps: number; every?: number }) => keyFrames(fig, o).tiles.map((t) => [t.frame, t.kinds.join('+')]);

test('one beat gives move at mid-travel, arrive after the arrival, read before the beat end, end before the loop end', () => {
  const { tiles, frames } = keyFrames(ONE, { fps: 20 });
  assert.equal(frames, 72);
  assert.deepEqual(
    tiles.map((t) => [t.frame, t.kinds.join('+')]),
    [
      [7, 'move'],
      [15, 'arrive'],
      [39, 'read'],
      [71, 'end'],
    ],
  );
});

test('the beat times equal the keyTimes and the dur that the SVG writes', () => {
  const fig: FlowProps = {
    ...ONE,
    steps: [...ONE.steps!, { label: 'read', flow: [{ edges: { edge: 'w', back: true }, ms: 1400 }, { edges: 'w' }] }],
  };
  const times = beatTimes(
    fig.steps!.map((s) => s.flow.map(toBeat)),
    900,
  );
  const svg = toSvg(fig);
  const motions = [...svg.matchAll(/<animateMotion dur="([\d.]+)s"[^>]*keyTimes="0;([\d.]+);([\d.]+);1"/g)];
  const loop = times.ends.at(-1)!;
  const hops = times.beats.flat();
  assert.equal(motions.length, hops.length);
  motions.forEach(([, dur, k0, k1], i) => {
    assert.ok(Math.abs(Number(dur) - loop) <= 0.05, `dur ${dur} vs ${loop}`);
    assert.ok(Math.abs(Number(k0) - hops[i].t0 / loop) <= 0.00005, `hop ${i} t0`);
    assert.ok(Math.abs(Number(k1) - hops[i].t1 / loop) <= 0.00005, `hop ${i} t1`);
  });
  keyFrames(fig, { fps: 20 }).tiles.forEach((t) => assert.ok(t.frame / 20 < Number(motions[0][1]), `tile ${t.frame} wraps`));
});

test('two kinds on one frame give one tile with both kinds in the label', () => {
  const fig: FlowProps = { ...ONE, steps: [{ label: 'write', flow: [{ edges: 'w', ms: 1000 }] }] };
  assert.deepEqual(kinds(fig, { fps: 20 }), [
    [7, 'move'],
    [15, 'arrive+read'],
    [47, 'end'],
  ]);
});

test('a back hop names the boxes in the travel direction', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { id: 'o', label: 'Orders' },
        { id: 'p', label: 'Payments' },
      ],
    },
    edges: [{ id: 'c', from: 'o', to: 'p', label: 'charge' }],
    steps: [{ label: 'refund', flow: [{ edges: { edge: 'c', back: true } }] }],
  };
  const move = keyFrames(fig, { fps: 20 }).tiles.find((t) => t.kinds.includes('move'))!;
  assert.equal(move.text, 'Payments → Orders (charge)');
});

test('a beat with two hops names both hops', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'Server' },
        { id: 'c', label: 'Log' },
      ],
    },
    edges: [
      { id: 'w', from: 'a', to: 'b', label: 'write' },
      { id: 'l', from: 'a', to: 'c', label: 'log' },
    ],
    steps: [{ label: 'write', flow: [['w', 'l']] }],
  };
  const move = keyFrames(fig, { fps: 20 }).tiles.find((t) => t.kinds.includes('move'))!;
  assert.equal(move.text, 'Client → Server (write); Client → Log (log)');
});

test('the grid for 17 tiles of a 912 x 631 figure has 4 columns and stays inside 1568 px', () => {
  const grid = sheetGrid(17, 912, 631);
  assert.equal(grid.cols, 4);
  assert.equal(grid.rows, 5);
  assert.equal(grid.tile, 382);
  assert.ok(Math.max(grid.width, grid.height) <= 1568, `${grid.width} x ${grid.height}`);
  assert.equal(grid.warning, undefined);
});

test('a 64-tile tall figure gives a tile under 160 px, and the warning names --step', () => {
  const grid = sheetGrid(64, 400, 800);
  assert.ok(grid.tile < 160, `tile ${grid.tile}`);
  assert.ok(Math.max(grid.width, grid.height) <= 1568, `${grid.width} x ${grid.height}`);
  assert.match(grid.warning ?? '', new RegExp(`${grid.tile} px.*--step <n>`));
});

test('--every snaps to the frame grid and names the phase at each time', () => {
  assert.deepEqual(kinds(ONE, { fps: 8, every: 300 }), [
    [0, 'move'],
    [2, 'move'],
    [5, 'move'],
    [7, 'read'],
    [10, 'read'],
    [12, 'read'],
    [14, 'read'],
    [17, 'hold'],
    [19, 'hold'],
    [22, 'hold'],
    [24, 'hold'],
    [26, 'hold'],
  ]);
});
