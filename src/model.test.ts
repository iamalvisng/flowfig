import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisions, edgeId, groupGap, isRows, nodes, toBeat } from './model.ts';

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
