import type { Figure } from '../src';

const props: Figure['props'] = {
  layout: {
    direction: 'column',
    children: [
      { label: 'Driver app', look: 'phone', children: [{ id: 'driver', label: 'Complete the delivery', sub: 'after the hand-over' }] },
      {
        label: 'Job orders API',
        look: 'server',
        direction: 'column',
        children: [
          {
            direction: 'row',
            children: [
              { id: 'type', label: 'Is it a delivery job?', shape: 'decision' },
              { id: 'refused', label: 'Refused', tone: 'gray' },
            ],
          },
          {
            direction: 'row',
            children: [
              { id: 'owner', label: 'May this user complete it?', shape: 'decision' },
              { id: 'repeat', label: 'Already completed?', shape: 'decision' },
              { id: 'nudge', label: 'Rerun a failed job', sub: 'on a repeat call' },
            ],
          },
          {
            direction: 'row',
            children: [
              { id: 'save', label: 'Save in one transaction', sub: 'job and history row' },
              { id: 'enqueue', label: 'Queue one delivery job', sub: 'Redis, keyed by job order' },
            ],
          },
        ],
      },
      {
        direction: 'row',
        children: [
          {
            label: 'Delivery job worker',
            look: 'gear',
            direction: 'column',
            children: [
              { id: 'mark', label: 'Mark the order delivered', sub: 'skips a delivered order' },
              { id: 'posted', label: 'Already posted?', shape: 'decision' },
              { id: 'out', label: 'Write the packs out' },
              { id: 'retry', label: 'Wait and try again', sub: '2, 4, 8, 16 s' },
              { id: 'final', label: 'Job kept for a rerun', sub: 'after 5 failed tries', tone: 'red' },
            ],
          },
          { id: 'agree', label: 'All records agree', sub: 'after one retry', tone: 'green' },
        ],
      },
      {
        direction: 'row',
        children: [
          { id: 'jobs', label: 'Job orders', shape: 'store' },
          { id: 'events', label: 'Job order events', shape: 'store' },
          { id: 'orders', label: 'Sales orders', shape: 'store' },
          { id: 'packs', label: 'Pack movements', shape: 'store' },
        ],
      },
    ],
  },
  edges: [
    { from: 'driver', to: 'type', label: 'complete' },
    { from: 'type', to: 'refused', label: 'no' },
    { from: 'type', to: 'owner', label: 'yes' },
    { from: 'owner', to: 'repeat', label: 'yes' },
    { from: 'repeat', to: 'nudge', label: 'yes' },
    { from: 'repeat', to: 'save', label: 'no' },
    { from: 'save', to: 'jobs', label: 'completed' },
    { from: 'save', to: 'events', label: 'history row' },
    { from: 'save', to: 'enqueue' },
    { from: 'nudge', to: 'mark', label: 'rerun' },
    { from: 'enqueue', to: 'mark', label: 'job' },
    { from: 'mark', to: 'orders', label: 'delivered' },
    { from: 'mark', to: 'posted' },
    { from: 'posted', to: 'out', label: 'no' },
    { from: 'out', to: 'packs', label: 'packs out' },
    { from: 'out', to: 'retry', label: 'error' },
    { from: 'retry', to: 'final', label: 'after 5 tries' },
    { from: 'packs', to: 'agree' },
  ],
  steps: [
    {
      label: 'Delivered',
      flow: [
        { edges: ['driver->type', 'type->owner', 'owner->repeat'], say: 'The driver taps complete. The API checks the job and the user.' },
        { edges: ['repeat->save', 'save->jobs', 'save->events'], say: 'The API saves the job and a history row together.' },
        { edges: 'save->enqueue', say: 'After the commit, the API queues one delivery job in Redis.' },
        {
          edges: ['enqueue->mark', { edge: 'mark->orders', data: 'status delivered' }],
          say: 'The worker marks the order delivered.',
        },
        { edges: ['mark->posted', 'posted->out', 'out->packs'], say: 'The same job then writes the packs out.' },
      ],
    },
    {
      label: 'Not a delivery job',
      flow: [{ edges: ['driver->type', 'type->refused'], say: 'The job is not a delivery job. The API refuses.' }],
    },
    {
      label: 'Ledger write fails',
      flow: [
        {
          edges: ['driver->type', 'type->owner', 'owner->repeat', 'repeat->save', 'save->jobs', 'save->events', 'save->enqueue'],
          say: 'The API saves the completed job and queues the delivery job.',
        },
        { edges: ['enqueue->mark', 'mark->posted', 'posted->out'], say: 'The worker tries to write the packs out.' },
        { edges: 'out->retry', say: 'The write fails once. The job waits in the queue.' },
        { edges: [{ edge: 'out->retry', back: true }, 'out->packs'], say: 'The job runs again, and the packs are written.' },
        { edges: 'packs->agree', say: 'The pack ledger matches the delivery.' },
      ],
    },
    {
      label: 'All tries fail',
      flow: [
        {
          edges: ['driver->type', 'type->owner', 'owner->repeat', 'repeat->save', 'save->enqueue'],
          say: 'The API saves the completed job and queues the delivery job.',
        },
        { edges: ['enqueue->mark', 'mark->posted', 'posted->out'], say: 'The worker tries to write the packs out.' },
        {
          edges: ['out->retry', 'retry->final'],
          say: 'Every try fails. After 5 tries, the job stops.',
          note: 'A failed job stays in Redis for a rerun.',
        },
      ],
    },
    {
      label: 'Repeat call',
      flow: [
        { edges: ['driver->type', 'type->owner', 'owner->repeat'], say: 'The driver taps complete on a completed job.' },
        { edges: ['repeat->nudge', 'nudge->mark'], say: 'The API reruns the failed delivery job.' },
      ],
    },
  ],
};

export default {
  title: 'A completed delivery, through a retried queue job',
  props,
} satisfies Figure;
