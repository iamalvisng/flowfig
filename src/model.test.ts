import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneColumns, beatMs, decisions, edgeId, groupGap, isRows, nodes, readMs, toBeat } from './model.ts';
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
