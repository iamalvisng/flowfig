import type { Figure } from '../src';

// An example state lifecycle: an order, with a start dot and two end rings.

const props: Figure['props'] = {
  layout: {
    direction: 'column',
    children: [
      {
        direction: 'row',
        children: [
          { id: 'new', label: 'New', mark: 'start' },
          { id: 'paid', label: 'Paid' },
          { id: 'shipped', label: 'Shipped' },
          { id: 'delivered', label: 'Delivered', mark: 'end' },
        ],
      },
      { direction: 'row', children: [{ id: 'cancelled', label: 'Cancelled', tone: 'gray', mark: 'end' }] },
    ],
  },
  edges: [
    { id: 'pay', from: 'new', to: 'paid', label: 'pay' },
    { id: 'ship', from: 'paid', to: 'shipped', label: 'ship' },
    { id: 'deliver', from: 'shipped', to: 'delivered', label: 'deliver' },
    { id: 'cancel-new', from: 'new', to: 'cancelled', label: 'cancel' },
    { id: 'cancel-paid', from: 'paid', to: 'cancelled', label: 'cancel' },
  ],
  steps: [
    {
      label: 'delivered',
      flow: [
        { edges: 'pay', say: 'The customer pays. The order is paid.' },
        { edges: 'ship', say: 'The warehouse ships the order.' },
        { edges: { edge: 'deliver', tone: 'green' }, say: 'The carrier delivers the order. This is an end state.' },
      ],
    },
    {
      label: 'cancelled',
      flow: [
        { edges: 'pay', say: 'The customer pays. The order is paid.' },
        { edges: { edge: 'cancel-paid', tone: 'red' }, say: 'The customer cancels before the shipment. This is an end state.' },
      ],
    },
  ],
};

export default {
  title: 'Order status',
  props,
} satisfies Figure;
