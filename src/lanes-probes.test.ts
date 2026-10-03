// The lanes wrap on three returns figures that agents drew in an evaluation (eval-L). They have diamonds and long edge labels.
// Before this test, two of them wrapped into blocks of 1 column, because the pill room of the stubs counted in the block width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, render } from './svg.ts';
import { lanePlan, laneColumns, type FlowProps } from './model.ts';

const probes: Record<string, FlowProps> = {
  L1: {
    lanes: true,
    layout: {
      direction: 'column',
      children: [
        {
          label: 'Customer',
          children: [
            { id: 'open', label: 'Open return', sub: 'within 30 days', at: 0 },
            { id: 'ship', label: 'Ship item', sub: 'within 14 days', at: 3 },
          ],
        },
        {
          label: 'Support',
          children: [
            { id: 'review', label: 'Review request', shape: 'decision', at: 1 },
            { id: 'label', label: 'Send label', at: 2 },
            { id: 'close', label: 'Close ticket', at: 6 },
            { id: 'reject', label: 'Email reason', sub: 'rejected', tone: 'red', at: 5 },
          ],
        },
        {
          label: 'Warehouse',
          children: [
            { id: 'inspect', label: 'Inspect item', sub: 'within 2 working days', shape: 'decision', at: 4 },
            { id: 'back', label: 'Ship damaged item back', tone: 'red', at: 5 },
          ],
        },
        { label: 'Finance', children: [{ id: 'refund', label: 'Refund', sub: 'within 3 working days', at: 5 }] },
      ],
    },
    edges: [
      { id: 'e1', from: 'open', to: 'review' },
      { id: 'e2', from: 'review', to: 'label', label: '30 days or less' },
      { id: 'e3', from: 'label', to: 'ship' },
      { id: 'e4', from: 'ship', to: 'inspect' },
      { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
      { id: 'e6', from: 'refund', to: 'close' },
      { id: 'r1', from: 'review', to: 'reject', label: 'after 30 days', around: 'above' },
      { id: 'r2', from: 'inspect', to: 'reject', label: 'damaged' },
      { id: 'r3', from: 'inspect', to: 'back', label: 'damaged' },
    ],
    steps: [
      { label: 'Approved', flow: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] },
      { label: 'Rejected', flow: ['e1', 'r1'] },
      { label: 'Damaged', flow: ['e4', ['r2', 'r3']] },
    ],
  },
  L2: {
    lanes: true,
    layout: {
      direction: 'column',
      children: [
        {
          label: 'Customer',
          children: [
            { id: 'open', label: 'Open return', at: 0 },
            { id: 'ship', label: 'Ship item', sub: 'within 14 days', at: 3 },
          ],
        },
        {
          label: 'Support agent',
          children: [
            { id: 'review', label: 'Within 30 days?', shape: 'decision', at: 1 },
            { id: 'label', label: 'Send label', at: 2 },
            { id: 'rejlate', label: 'Email reason', tone: 'red', at: 3 },
            { id: 'rejdam', label: 'Email reason', tone: 'red', at: 5 },
            { id: 'close', label: 'Close ticket', at: 6 },
          ],
        },
        {
          label: 'Warehouse',
          children: [
            { id: 'inspect', label: 'Item OK?', shape: 'decision', sub: 'within 2 working days', at: 4 },
            { id: 'back', label: 'Ship item back', tone: 'red', at: 5 },
          ],
        },
        { label: 'Finance', children: [{ id: 'refund', label: 'Refund', sub: 'within 3 working days', at: 5 }] },
      ],
    },
    edges: [
      { id: 'e1', from: 'open', to: 'review' },
      { id: 'e2', from: 'review', to: 'label', label: 'yes' },
      { id: 'e3', from: 'label', to: 'ship' },
      { id: 'e4', from: 'ship', to: 'inspect' },
      { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
      { id: 'e6', from: 'refund', to: 'close' },
      { id: 'r1', from: 'review', to: 'rejlate', label: 'no' },
      { id: 'r2', from: 'inspect', to: 'rejdam', label: 'damaged' },
      { id: 'r3', from: 'inspect', to: 'back' },
    ],
    steps: [
      { label: 'Approved', flow: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] },
      { label: 'Rejected', flow: ['e1', 'r1', { say: 'A request after 30 days is rejected.' }, 'e1', 'e2', 'e3', 'e4', ['r2', 'r3']] },
    ],
  },
  L3: {
    lanes: true,
    layout: {
      direction: 'column',
      children: [
        {
          label: 'Customer',
          children: [
            { id: 'open', label: 'Open a return', sub: 'within 30 days', at: 0 },
            { id: 'ship', label: 'Ship the item', sub: 'within 14 days', at: 3 },
          ],
        },
        {
          label: 'Support',
          children: [
            { id: 'review', label: 'Review', sub: '30 days, reason', shape: 'decision', at: 1 },
            { id: 'label', label: 'Send label', at: 2 },
            { id: 'rejected', label: 'Email reason', sub: 'reply in 7 days', tone: 'red', at: 5 },
            { id: 'close', label: 'Close ticket', at: 6 },
          ],
        },
        {
          label: 'Warehouse',
          children: [
            { id: 'inspect', label: 'Inspect', sub: 'within 2 working days', shape: 'decision', at: 4 },
            { id: 'back', label: 'Ship item back', tone: 'red', at: 6 },
          ],
        },
        { label: 'Finance', children: [{ id: 'refund', label: 'Refund', sub: 'within 3 working days', at: 5 }] },
      ],
    },
    edges: [
      { id: 'e1', from: 'open', to: 'review' },
      { id: 'e2', from: 'review', to: 'label', label: 'ok' },
      { id: 'e3', from: 'label', to: 'ship' },
      { id: 'e4', from: 'ship', to: 'inspect' },
      { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
      { id: 'e6', from: 'refund', to: 'close' },
      { id: 'r1', from: 'review', to: 'rejected', label: 'late', around: 'below' },
      { id: 'r2', from: 'inspect', to: 'rejected', label: 'damaged' },
      { id: 'r3', from: 'inspect', to: 'back', label: 'damaged' },
    ],
    steps: [
      { label: 'Refund', flow: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] },
      { label: 'Late request', flow: ['e1', 'r1'] },
      { label: 'Damaged item', flow: ['e1', 'e2', 'e3', 'e4', ['r2', 'r3']] },
    ],
  },
};

for (const [name, fig] of Object.entries(probes))
  test(`lanes wrap: probe ${name} has 2 columns or more per block, the fewest blocks that fit, and check --strict is clean`, () => {
    const plan = lanePlan(fig);
    const n = Math.max(...laneColumns(fig).values()) + 1;
    const sizes = plan.blocks.map((k) => plan.starts[k + 1] - plan.starts[k]);
    assert.ok(
      sizes.every((c) => c >= 2),
      sizes.join(','),
    );
    assert.equal(
      sizes.reduce((a, b) => a + b, 0),
      n,
    );
    assert.ok(plan.blocks.length <= 3);
    assert.deepEqual(check(fig, { width: 830 }), []);
    assert.ok(!render(fig).svg.includes('NaN'));
  });
