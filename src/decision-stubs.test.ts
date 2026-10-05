import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, render } from './svg.ts';
import type { FlowProps } from './model.ts';

const o1: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          {
            id: 'open',
            label: 'Open a return',
            sub: 'within 30 days of delivery',
            at: 0,
            source: 'docs/sop/returns.md#step-1-open-a-return',
            width: 170,
          },
          {
            id: 'ship',
            label: 'Ship the item',
            sub: 'with label, within 14 days',
            at: 3,
            source: 'docs/sop/returns.md#step-4-ship-the-item',
            width: 170,
          },
        ],
      },
      {
        label: 'Support',
        children: [
          {
            id: 'review',
            label: 'Review the request',
            sub: 'delivery date, reason',
            shape: 'decision',
            at: 1,
            source: 'docs/sop/returns.md#step-2-review-the-request',
            width: 170,
          },
          {
            id: 'label',
            label: 'Send the label',
            sub: 'prepaid label by email',
            at: 2,
            source: 'docs/sop/returns.md#step-3-send-the-label',
            width: 170,
          },
          {
            id: 'rejlate',
            label: 'Reject: late',
            sub: 'email reason',
            tone: 'red',
            at: 3,
            source: 'docs/sop/returns.md#rejected',
            width: 170,
          },
          {
            id: 'rejdmg',
            label: 'Reject: damaged',
            sub: 'email reason',
            tone: 'red',
            at: 5,
            source: 'docs/sop/returns.md#rejected',
            width: 170,
          },
          {
            id: 'close',
            label: 'Close the ticket',
            sub: 'customer gets email',
            tone: 'green',
            at: 6,
            source: 'docs/sop/returns.md#step-7-close',
            width: 170,
          },
        ],
      },
      {
        label: 'Warehouse',
        children: [
          {
            id: 'inspect',
            label: 'Inspect the item',
            sub: 'within 2 working days',
            shape: 'decision',
            at: 4,
            source: 'docs/sop/returns.md#step-5-inspect-the-item',
            width: 170,
          },
          { id: 'back', label: 'Ship the item back', sub: 'damaged item', at: 6, source: 'docs/sop/returns.md#rejected', width: 170 },
        ],
      },
      {
        label: 'Finance',
        children: [
          { id: 'refund', label: 'Refund', sub: 'within 3 working days', at: 5, source: 'docs/sop/returns.md#step-6-refund', width: 170 },
        ],
      },
    ],
  },
  edges: [
    { id: 'e1', from: 'open', to: 'review', label: 'request' },
    { id: 'e2', from: 'review', to: 'label', label: 'in time' },
    { id: 'e2x', from: 'review', to: 'rejlate', label: 'after 30 days' },
    { id: 'e3', from: 'label', to: 'ship', label: 'label' },
    { id: 'e4', from: 'ship', to: 'inspect', label: 'item' },
    { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
    { id: 'e5x', from: 'inspect', to: 'rejdmg', label: 'damaged' },
    { id: 'e6', from: 'refund', to: 'close', label: 'refund' },
    { id: 'r3', from: 'rejdmg', to: 'back', label: 'ship back' },
  ],
  steps: [
    {
      label: 'Approved return',
      flow: [
        { edges: 'e1', say: 'The customer opens a return from the order page within 30 days of delivery and picks a reason.' },
        { edges: 'e2', say: 'Support finds the request in time.' },
        { edges: 'e3', say: 'Support emails a prepaid label.' },
        { edges: 'e4', say: 'The customer ships within 14 days.' },
        { edges: 'e5', say: 'The warehouse inspects within 2 working days of arrival. The item passes.' },
        {
          edges: 'e6',
          say: 'Finance refunds the original payment method within 3 working days. Support closes the ticket. The customer gets a confirmation email.',
        },
      ],
    },
    {
      label: 'Late request',
      flow: [
        { edges: 'e1', say: 'The customer opens a return.' },
        { edges: 'e2x', say: 'The request is after 30 days. Support emails the reason. The customer can reply within 7 days.' },
      ],
    },
    {
      label: 'Damaged item',
      flow: [
        { edges: 'e4', say: 'The customer ships the item with the label within 14 days.' },
        { edges: 'e5x', say: 'The warehouse inspects within 2 working days of arrival. The item is damaged.' },
        { edges: 'r3', say: 'Support emails the reason. The customer can reply within 7 days. The warehouse ships the damaged item back.' },
      ],
    },
  ],
};
const o2: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          {
            id: 'open',
            label: 'Open a return',
            sub: 'Within 30 days of delivery',
            at: 0,
            source: 'docs/sop/returns.md#step-1-open-a-return',
          },
          { id: 'ship', label: 'Ship the item', sub: 'Within 14 days', at: 3, source: 'docs/sop/returns.md#step-4-ship-the-item' },
        ],
      },
      {
        label: 'Support agent',
        children: [
          {
            id: 'review',
            label: 'Review the request',
            sub: 'Date and reason',
            shape: 'decision',
            at: 1,
            source: 'docs/sop/returns.md#step-2-review-the-request',
          },
          { id: 'label', label: 'Send the label', sub: 'Prepaid label email', at: 2, source: 'docs/sop/returns.md#step-3-send-the-label' },
          { id: 'rejLate', label: 'Rejected: late', sub: 'Email the reason', tone: 'red', at: 3, source: 'docs/sop/returns.md#rejected' },
          { id: 'rejDmg', label: 'Rejected: damaged', sub: 'Email the reason', tone: 'red', at: 5, source: 'docs/sop/returns.md#rejected' },
          { id: 'close', label: 'Close', sub: 'Confirmation email', at: 6, source: 'docs/sop/returns.md#step-7-close' },
        ],
      },
      {
        label: 'Warehouse',
        children: [
          {
            id: 'inspect',
            label: 'Inspect the item',
            sub: 'Within 2 working days',
            shape: 'decision',
            at: 4,
            source: 'docs/sop/returns.md#step-5-inspect-the-item',
          },
          { id: 'back', label: 'Ship the item back', sub: 'Damaged item', tone: 'red', at: 6, source: 'docs/sop/returns.md#rejected' },
        ],
      },
      {
        label: 'Finance',
        children: [{ id: 'refund', label: 'Refund', sub: 'Within 3 working days', at: 5, source: 'docs/sop/returns.md#step-6-refund' }],
      },
    ],
  },
  edges: [
    { id: 'e1', from: 'open', to: 'review' },
    { id: 'e2', from: 'review', to: 'label' },
    { id: 'e3', from: 'label', to: 'ship' },
    { id: 'e4', from: 'ship', to: 'inspect' },
    { id: 'e5', from: 'inspect', to: 'refund', label: 'passed' },
    { id: 'e6', from: 'refund', to: 'close' },
    { id: 'r1', from: 'review', to: 'rejLate', label: 'after 30 days' },
    { id: 'r2', from: 'inspect', to: 'rejDmg', label: 'damaged' },
    { id: 'r3', from: 'rejDmg', to: 'back' },
  ],
  steps: [
    {
      label: 'Accepted',
      flow: [
        { edges: 'e1', say: 'The customer opens a return from the order page within 30 days of delivery and picks a reason.' },
        { edges: 'e2', say: 'A support agent checks the delivery date and the reason.' },
        { edges: 'e3', say: 'Support emails a prepaid shipping label to the customer.' },
        {
          edges: 'e4',
          say: 'The customer ships the item with the label within 14 days. The warehouse inspects it within 2 days.',
        },
        { edges: 'e5', say: 'Finance refunds the original payment method within 3 working days of a passed inspection.' },
        { edges: 'e6', say: 'Support closes the ticket and the customer gets a confirmation email.' },
      ],
    },
    {
      label: 'Late request',
      flow: [
        { edges: 'e1', say: 'The customer opens a return from the order page within 30 days of delivery and picks a reason.' },
        { edges: 'r1', say: 'A request after 30 days is rejected. Support emails the reason. The customer can reply within 7 days.' },
      ],
    },
    {
      label: 'Damaged item',
      flow: [
        { edges: 'e1', say: 'The customer opens a return from the order page within 30 days of delivery and picks a reason.' },
        { edges: 'e2', say: 'A support agent checks the delivery date and the reason.' },
        { edges: 'e3', say: 'Support emails a prepaid shipping label to the customer.' },
        {
          edges: 'e4',
          say: 'The customer ships the item with the label within 14 days. The warehouse inspects it within 2 days.',
        },
        { edges: 'r2', say: 'The warehouse finds a damaged item. Support emails the reason. The customer can reply within 7 days.' },
        { edges: 'r3', say: 'The warehouse ships the damaged item back.' },
      ],
    },
  ],
};

for (const [name, fig] of [
  ['o1', o1],
  ['o2', o2],
] as const)
  test(`decision stubs: ${name} passes check --strict at 830 px, and every pill is inside the figure and one lane`, () => {
    assert.deepEqual(check(fig, { width: 830 }), []);
    const { scene } = render(fig, { width: 830 });
    const pills = scene.edges.filter((e) => e.pts && e.label);
    assert.ok(pills.length > 0);
    for (const e of pills) {
      const p = e.label!;
      assert.ok(p.x >= 0 && p.x + p.w <= scene.width, `pill of ${e.id} leaves the figure`);
      assert.ok(
        (scene.lanes ?? []).some(
          (l) => p.x >= l.rect.x && p.x + p.w <= l.rect.x + l.rect.w && p.y >= l.rect.y && p.y + p.h <= l.rect.y + l.rect.h,
        ),
        `pill of ${e.id} is in no lane`,
      );
    }
  });
