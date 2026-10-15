import type { Figure } from '../src';

const props: Figure['props'] = {
  layout: {
    direction: 'column',
    children: [
      { label: 'Driver app', look: 'phone', children: [{ id: 'driver', label: 'Complete the delivery', sub: 'after the hand-over' }] },
      {
        label: 'Delivery jobs API',
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
              { id: 'noop', label: 'Nothing written', sub: 'no second announce', tone: 'gray' },
            ],
          },
          {
            direction: 'row',
            children: [
              { id: 'save', label: 'Save in one transaction', sub: 'job and history row' },
              { id: 'announce', label: 'Announce the delivery', sub: 'in-memory event' },
            ],
          },
        ],
      },
      {
        direction: 'row',
        children: [
          {
            label: 'Order listener',
            look: 'gear',
            direction: 'column',
            children: [
              { id: 'mark', label: 'Mark the order delivered' },
              { id: 'ocatch', label: 'On error: log it, stop', sub: 'no retry', tone: 'red' },
            ],
          },
          {
            label: 'Parcel ledger listener',
            look: 'gear',
            direction: 'column',
            children: [
              { id: 'posted', label: 'Already posted?', shape: 'decision' },
              { id: 'out', label: 'Write the parcels out' },
              { id: 'pcatch', label: 'Ledger miss logged', sub: 'no retry, no record', tone: 'red' },
            ],
          },
        ],
      },
      {
        direction: 'row',
        children: [
          { id: 'jobs', label: 'Delivery jobs', shape: 'store' },
          { id: 'events', label: 'Delivery job events', shape: 'store' },
          { id: 'orders', label: 'Sales orders', shape: 'store' },
          { id: 'parcels', label: 'Parcel moves', shape: 'store' },
        ],
      },
    ],
  },
  edges: [
    { from: 'driver', to: 'type', label: 'complete' },
    { from: 'type', to: 'refused', label: 'no' },
    { from: 'type', to: 'owner', label: 'yes' },
    { from: 'owner', to: 'repeat', label: 'yes' },
    { from: 'repeat', to: 'noop', label: 'yes' },
    { from: 'repeat', to: 'save', label: 'no' },
    { from: 'save', to: 'jobs', label: 'completed' },
    { from: 'save', to: 'events', label: 'history row' },
    { from: 'save', to: 'announce' },
    { from: 'announce', to: 'mark', label: 'event' },
    { from: 'announce', to: 'posted', label: 'event' },
    { from: 'mark', to: 'orders', label: 'delivered' },
    { from: 'mark', to: 'ocatch', label: 'error' },
    { from: 'posted', to: 'out', label: 'no' },
    { from: 'out', to: 'parcels', label: 'parcels out' },
    { from: 'out', to: 'pcatch', label: 'error' },
  ],
  steps: [
    {
      label: 'Delivered',
      flow: [
        { edges: ['driver->type', 'type->owner', 'owner->repeat'], say: 'The driver taps complete. The API checks the job and the user.' },
        { edges: ['repeat->save', 'save->jobs', 'save->events'], say: 'The API saves the job and a history row together.' },
        { edges: 'save->announce', say: 'After the commit, the API announces the delivery in memory.' },
        { edges: ['announce->mark', 'mark->orders'], say: 'The order listener marks the order delivered.' },
        { edges: ['announce->posted', 'posted->out', 'out->parcels'], say: 'The parcel ledger listener writes the parcels out.' },
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
          edges: ['driver->type', 'type->owner', 'owner->repeat', 'repeat->save', 'save->jobs', 'save->events'],
          say: 'The API saves the completed job.',
        },
        { edges: ['save->announce', 'announce->posted', 'posted->out'], say: 'The parcel ledger listener tries to write the parcels out.' },
        {
          edges: 'out->pcatch',
          say: 'The write fails. The listener logs the error and stops.',
          note: 'Nothing runs the write again.',
        },
      ],
    },
  ],
};

export default {
  title: 'A completed delivery, before the queue',
  props,
} satisfies Figure;
