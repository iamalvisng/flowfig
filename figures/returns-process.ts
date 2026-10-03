import type { Figure } from '../src';

// An example process: a return across four roles in seven steps. The time columns do not fit 830 px, so the lanes wrap into two blocks.

const sop = 'docs/sop/returns.md';
const props: Figure['props'] = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        id: 'customer',
        label: 'Customer',
        children: [
          { id: 'open', label: 'Open return', sub: '30 days', source: `${sop}#step-1-open-a-return` },
          { id: 'ship', label: 'Ship item', sub: '14 days', source: `${sop}#step-4-ship-the-item` },
        ],
      },
      {
        id: 'support',
        label: 'Support',
        children: [
          { id: 'review', label: 'Review', sub: 'date, reason', source: `${sop}#step-2-review-the-request` },
          { id: 'label', label: 'Send label', sub: 'prepaid', source: `${sop}#step-3-send-the-label` },
          { id: 'rejected', label: 'Rejected', sub: 'email reason', tone: 'red', at: 5, source: `${sop}#rejected` },
          { id: 'close', label: 'Close', sub: 'confirmation', source: `${sop}#step-7-close` },
        ],
      },
      {
        id: 'warehouse',
        label: 'Warehouse',
        children: [{ id: 'inspect', label: 'Inspect', sub: '2 working days', source: `${sop}#step-5-inspect-the-item` }],
      },
      {
        id: 'finance',
        label: 'Finance',
        children: [{ id: 'refund', label: 'Refund', sub: '3 working days', source: `${sop}#step-6-refund` }],
      },
    ],
  },
  edges: [
    { id: 'request', from: 'open', to: 'review' },
    { id: 'approve', from: 'review', to: 'label', label: 'ok' },
    { id: 'email', from: 'label', to: 'ship' },
    { id: 'arrive', from: 'ship', to: 'inspect' },
    { id: 'pass', from: 'inspect', to: 'refund', label: 'passed' },
    { id: 'paid', from: 'refund', to: 'close' },
    { id: 'late', from: 'review', to: 'rejected', label: 'late', around: 'below' },
    { id: 'damaged', from: 'inspect', to: 'rejected', label: 'damaged' },
  ],
  steps: [
    {
      label: 'returned',
      flow: [
        { edges: 'request', say: 'The customer opens a return from the order page and picks a reason.' },
        { edges: { edge: 'approve', tone: 'green' }, say: 'Support checks the delivery date and the reason.' },
        { edges: 'email', say: 'Support emails a prepaid shipping label.' },
        { edges: 'arrive', say: 'The customer ships the item within 14 days.' },
        { edges: { edge: 'pass', tone: 'green' }, say: 'The warehouse inspects the item within 2 working days.' },
        { edges: 'paid', say: 'Finance refunds the original payment method. Support closes the ticket.' },
      ],
    },
    {
      label: 'rejected: late',
      flow: [
        { edges: 'request', say: 'The customer opens a return after 30 days.' },
        { edges: { edge: 'late', tone: 'red' }, say: 'Support rejects the request and emails the reason.' },
      ],
    },
    {
      label: 'rejected: damaged',
      flow: [
        { edges: 'request', say: 'The customer opens a return.' },
        { edges: 'approve', say: 'Support approves the request.' },
        { edges: 'email', say: 'Support emails a prepaid shipping label.' },
        { edges: 'arrive', say: 'The customer ships the item.' },
        {
          edges: { edge: 'damaged', tone: 'red' },
          say: 'The item is damaged. Support emails the reason, and the warehouse ships the item back.',
        },
      ],
    },
  ],
};

export default {
  title: 'Returns process',
  props,
} satisfies Figure;
