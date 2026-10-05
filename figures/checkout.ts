import type { Figure } from '../src';

// An example sequence: an order checkout, with a parallel beat and an async webhook, drawn with the rail.

const props: Figure['props'] = {
  rail: true,
  layout: {
    gap: 90,
    children: [
      { id: 'browser', label: 'Browser' },
      { label: 'Edge', direction: 'column', children: [{ id: 'gateway', label: 'Gateway', source: 'examples/shop/gateway.ts#checkout' }] },
      {
        label: 'Order service',
        direction: 'column',
        gap: 36,
        children: [
          { id: 'orders', label: 'Orders', width: 170, source: 'examples/shop/orders.ts#createOrder' },
          { id: 'db', label: 'Orders DB', shape: 'store', width: 170, source: 'examples/shop/db.ts#insertOrder' },
        ],
      },
      {
        label: 'External',
        direction: 'column',
        children: [{ id: 'payments', label: 'Payments', source: 'examples/shop/payments.ts#charge' }],
      },
    ],
  },
  edges: [
    { id: 'submit', from: 'browser', to: 'gateway', label: 'checkout' },
    { id: 'create', from: 'gateway', to: 'orders', label: 'create', source: 'examples/shop/gateway.ts#checkout' },
    { id: 'charge', from: 'orders', to: 'payments', label: 'charge', source: 'examples/shop/orders.ts#createOrder' },
    { id: 'insert', from: 'orders', to: 'db', label: 'INSERT', source: 'examples/shop/orders.ts#createOrder' },
  ],
  steps: [
    {
      label: 'submit',
      flow: [
        { edges: { edge: 'submit', data: '3 items · $42.00' }, say: 'The browser sends the cart.' },
        { edges: 'create', say: 'The gateway asks the order service to create the order.' },
      ],
    },
    {
      label: 'pay',
      flow: [
        {
          edges: [
            { edge: 'charge', data: 'charge $42.00' },
            { edge: 'insert', data: 'order #981' },
          ],
          say: 'Orders charges the card and writes the order at the same time.',
        },
        { edges: { edge: 'charge', back: true, async: true, data: 'webhook: paid' }, say: 'Payments confirms later, with a webhook.' },
        { edges: { edge: 'submit', back: true, data: '201 Created' }, say: 'The browser gets the order number.' },
      ],
    },
  ],
};

export default { title: 'Order checkout (sequence rail)', props } satisfies Figure;
