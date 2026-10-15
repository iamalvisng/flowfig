import type { Figure } from '../src';

const props: Figure['props'] = {
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        look: 'person',
        direction: 'row',
        children: [
          { id: 'order', label: 'Order a cake', sub: 'in the app', done: 'Cake ordered' },
          { id: 'receive', label: 'Get the cake', done: 'Cake delivered' },
        ],
      },
      {
        direction: 'row',
        gap: 24,
        children: [
          {
            label: 'Bakery',
            look: 'shop',
            direction: 'row',
            gap: 28,
            children: [
              {
                direction: 'column',
                children: [
                  { id: 'zone', label: 'Delivery zone?', shape: 'decision' },
                  { id: 'far', label: 'Too far', sub: 'order refused', tone: 'red' },
                ],
              },
              {
                direction: 'column',
                children: [
                  { id: 'stock', label: 'In stock?', shape: 'decision' },
                  { id: 'soldout', label: 'Sold out', sub: 'order refused', tone: 'red' },
                ],
              },
              { id: 'bake', label: 'Bake', sub: 'the cake', done: 'Cake baked' },
            ],
          },
          {
            label: 'Courier',
            look: 'truck',
            children: [{ id: 'drive', label: 'Drive', sub: 'to the door', done: 'At the door' }],
          },
        ],
      },
    ],
  },
  edges: [
    { from: 'order', to: 'zone', label: 'order' },
    { from: 'zone', to: 'far', label: 'no' },
    { from: 'zone', to: 'stock', label: 'yes' },
    { from: 'stock', to: 'soldout', label: 'no' },
    { from: 'stock', to: 'bake', label: 'yes' },
    { from: 'bake', to: 'drive', label: 'cake', carries: { thing: 'cake', form: 'box' } },
    { from: 'drive', to: 'receive', label: 'deliver', carries: { thing: 'cake', form: 'box' } },
  ],
  steps: [
    {
      label: 'Delivered',
      outcome: 'The courier hands the cake to the customer at the door.',
      flow: [
        { edges: 'order->zone', say: 'The customer orders a cake in the app.' },
        { edges: 'zone->stock', say: 'The address is in the delivery zone.' },
        { edges: 'stock->bake', say: 'The cake is in stock, so the bakery bakes it.' },
        { edges: 'bake->drive', say: 'The bakery hands the boxed cake to the courier.' },
        { edges: 'drive->receive', say: 'The courier drives the cake to the door.' },
      ],
    },
    {
      label: 'Sold out',
      outcome: 'The bakery refuses the order. The customer gets no cake.',
      flow: [
        { edges: 'order->zone', say: 'The customer orders a cake in the app.' },
        { edges: 'zone->stock', say: 'The address is in the delivery zone.' },
        { edges: 'stock->soldout', say: 'The cake is sold out, so the bakery refuses the order.' },
      ],
    },
    {
      label: 'Too far',
      outcome: 'The bakery refuses the order before it checks the stock.',
      flow: [
        { edges: 'order->zone', say: 'The customer orders a cake for an address far away.' },
        { edges: 'zone->far', say: 'The address is outside the delivery zone, so the bakery refuses.' },
      ],
    },
  ],
};

export default {
  title: 'How a cake order reaches the door',
  props,
} satisfies Figure;
