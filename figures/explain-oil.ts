import type { Figure } from '../src';

const props: Figure['props'] = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        look: 'person',
        children: [
          { id: 'ask', label: 'Ask for a pickup', at: 0 },
          { id: 'toomany', label: 'Told: too many requests', at: 2, tone: 'gray' },
          { id: 'nofree', label: 'Told: no worker free', at: 4, tone: 'gray' },
          { id: 'paid', label: 'Gets paid', at: 12 },
        ],
      },
      {
        label: 'Office',
        look: 'desk',
        children: [
          { id: 'many', label: 'Under the limit?', shape: 'decision', at: 1 },
          { id: 'accept', label: 'Accept the request', at: 2 },
          { id: 'free', label: 'Worker free?', shape: 'decision', at: 3 },
          { id: 'assign', label: 'Assign the job', at: 4 },
          { id: 'cash', label: 'Paid in cash?', shape: 'decision', at: 10 },
          { id: 'settle', label: 'Settle the voucher', at: 11 },
        ],
      },
      {
        label: 'Worker',
        look: 'truck',
        children: [
          { id: 'collect', label: 'Pump and weigh', at: 5 },
          { id: 'sign', label: 'Customer signs', at: 6 },
          { id: 'sync', label: 'Phone syncs', at: 7 },
          { id: 'refused', label: 'Record refused', at: 9, tone: 'gray' },
        ],
      },
      {
        label: 'Server',
        look: 'server',
        children: [
          { id: 'cert', label: 'Allowed to sell?', shape: 'decision', at: 8 },
          { id: 'save', label: 'Save collection and voucher', sub: 'all or nothing', at: 9 },
          { id: 'stock', label: 'Add to stock', at: 10 },
        ],
      },
    ],
  },
  edges: [
    { from: 'ask', to: 'many' },
    { from: 'many', to: 'accept', label: 'yes' },
    { from: 'many', to: 'toomany', label: 'no' },
    { from: 'accept', to: 'free' },
    { from: 'free', to: 'assign', label: 'yes' },
    { from: 'free', to: 'nofree', label: 'no' },
    { from: 'assign', to: 'collect', label: 'push to phone' },
    { from: 'collect', to: 'sign', label: 'pump and weigh', carries: { thing: 'used oil', form: 'barrel', count: 4, from: 'ask' } },
    { from: 'sign', to: 'sync' },
    { from: 'sync', to: 'cert' },
    { from: 'cert', to: 'save', label: 'yes' },
    { from: 'cert', to: 'refused', label: 'expired' },
    { from: 'save', to: 'stock', carries: { thing: 'used oil', from: 'collect' } },
    { from: 'save', to: 'cash' },
    { from: 'cash', to: 'paid', label: 'yes', carries: { thing: 'cash', form: 'notes', from: 'collect' } },
    { from: 'cash', to: 'settle', label: 'no' },
    { from: 'settle', to: 'paid' },
  ],
  steps: [
    {
      label: 'Normal pickup',
      outcome: 'The worker collects the oil, and the office pays the customer by voucher.',
      flow: [
        { edges: 'ask->many', say: 'The customer asks for a pickup in the app.' },
        { edges: ['many->accept', 'accept->free'], say: 'The office accepts it and looks for a free worker.' },
        { edges: ['free->assign', 'assign->collect'], say: 'The office assigns the job. The worker gets a push.' },
        { edges: ['collect->sign', 'sign->sync'], say: 'The worker weighs the oil. The customer signs.' },
        { edges: ['sync->cert', 'cert->save'], say: 'The server checks the client and saves both records together.' },
        {
          edges: ['save->stock', 'save->cash', 'cash->settle', 'settle->paid'],
          say: 'The oil goes into stock. The office settles the voucher.',
        },
      ],
    },
    {
      label: 'Paid in cash',
      outcome: 'The worker pays the customer in cash at the pickup.',
      flow: [
        { edges: ['ask->many', 'many->accept', 'accept->free', 'free->assign'], say: 'The office accepts and assigns the job.' },
        { edges: ['assign->collect', 'collect->sign', 'sign->sync'], say: 'The worker collects the oil and pays cash.' },
        {
          edges: ['sync->cert', 'cert->save', 'save->cash', 'cash->paid'],
          say: 'The voucher is already settled. Nothing waits for the office.',
        },
      ],
    },
    {
      label: 'Too many requests',
      outcome: 'The app refuses the request. No worker comes.',
      flow: [{ edges: ['ask->many', 'many->toomany'], say: 'The customer has too many open requests. The app refuses.' }],
    },
    {
      label: 'No worker free',
      outcome: 'The office refuses the request. No worker comes.',
      flow: [
        {
          edges: ['ask->many', 'many->accept', 'accept->free', 'free->nofree'],
          say: 'No worker is free. The office cannot accept the request.',
        },
      ],
    },
    {
      label: 'Expired certification',
      outcome: 'The oil is already in the truck when the server says no.',
      flow: [
        {
          edges: ['ask->many', 'many->accept', 'accept->free', 'free->assign'],
          say: 'The request passes every office check.',
          note: 'The office does not see the certification.',
        },
        { edges: ['assign->collect', 'collect->sign', 'sign->sync'], say: 'The worker collects the oil from the customer.' },
        {
          edges: ['sync->cert', 'cert->refused'],
          say: 'Only now does the server see the expired certification.',
          note: 'The oil is collected, but no one is paid.',
        },
      ],
    },
  ],
};

export default {
  title: 'How used oil becomes a payment',
  props,
} satisfies Figure;
