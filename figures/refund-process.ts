import type { Figure } from '../src';

// An example process: a refund across three roles, drawn as swimlanes and linked to the SOP.

const props: Figure['props'] = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        id: 'customer',
        label: 'Customer',
        children: [
          { id: 'ask', label: 'Request refund', sub: 'order page', source: 'docs/sop/refunds.md#step-1-request-a-refund' },
          { id: 'done', label: 'Confirmation', at: 3, sub: 'email', source: 'docs/sop/refunds.md#step-5-notify-the-customer' },
          { id: 'no', label: 'Rejection', tone: 'red', at: 2, sub: 'email, reason', source: 'docs/sop/refunds.md#rejected' },
        ],
      },
      {
        id: 'support',
        label: 'Support',
        children: [
          {
            id: 'check',
            label: 'Order in policy?',
            shape: 'decision',
            sub: '30 days, item state',
            source: 'docs/sop/refunds.md#step-3-approve-or-reject',
          },
          { id: 'close', label: 'Close ticket', source: 'docs/sop/refunds.md#step-5-notify-the-customer' },
        ],
      },
      {
        id: 'finance',
        label: 'Finance',
        children: [{ id: 'pay', label: 'Issue refund', sub: '3 working days', source: 'docs/sop/refunds.md#step-4-issue-the-refund' }],
      },
    ],
  },
  edges: [
    { id: 'open', from: 'ask', to: 'check', label: 'ticket' },
    { id: 'yes', from: 'check', to: 'pay', label: 'yes' },
    { id: 'paid', from: 'pay', to: 'close', label: 'paid' },
    { id: 'notify', from: 'close', to: 'done', label: 'email' },
    { id: 'reject', from: 'check', to: 'no', label: 'no' },
  ],
  steps: [
    {
      label: 'approved',
      flow: [
        {
          edges: 'open',
          say: 'The customer asks for a refund from the order page. Support checks the age, the item state and the reason.',
        },
        { edges: { edge: 'yes', tone: 'green' }, say: 'The request is inside the policy.' },
        { edges: 'paid', say: 'Finance refunds the original payment method.' },
        { edges: { edge: 'notify', tone: 'green' }, say: 'The customer gets the confirmation email.' },
      ],
    },
    {
      label: 'rejected',
      flow: [
        { edges: 'open', say: 'The customer asks for a refund. Support checks the order.' },
        { edges: { edge: 'reject', tone: 'red' }, say: 'The request is outside the policy. The customer gets the reason.' },
      ],
    },
  ],
};

export default {
  title: 'Refund process',
  props,
} satisfies Figure;
