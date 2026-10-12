import type { Figure } from '../src';

const props: Figure['props'] = {
  layout: {
    direction: 'column',
    children: [
      {
        direction: 'row',
        children: [
          { id: 'app', label: 'Worker app', sub: 'sends saved records', look: 'phone' },
          {
            direction: 'column',
            children: [
              { id: 'dup', label: 'Saved before?', shape: 'decision' },
              { id: 'dupno', label: 'Answer: DUPLICATE', tone: 'gray' },
            ],
          },
          {
            direction: 'column',
            children: [
              { id: 'client', label: 'Client allowed?', shape: 'decision' },
              { id: 'clientno', label: 'Answer: refused', tone: 'gray' },
            ],
          },
        ],
      },
      {
        direction: 'row',
        children: [
          { id: 'txn', label: 'Save in one transaction', sub: 'collection, audit, voucher', look: 'server' },
          {
            direction: 'column',
            children: [
              { id: 'voucher', label: 'Voucher OK?', shape: 'decision' },
              { id: 'rollback', label: 'Rolled back', sub: 'no table changes', tone: 'gray' },
            ],
          },
          { id: 'db', label: 'Postgres', shape: 'store', look: 'cabinet' },
        ],
      },
      {
        direction: 'row',
        children: [
          { id: 'event', label: 'collection.created' },
          {
            direction: 'column',
            children: [
              { id: 'jobs', label: 'Job orders' },
              { id: 'stock', label: 'Stock' },
            ],
          },
          { id: 'push', label: 'Push queue', shape: 'store', look: 'queue' },
          { id: 'phone', label: 'Firebase push', look: 'cloud' },
        ],
      },
    ],
  },
  edges: [
    { from: 'app', to: 'dup', label: 'record' },
    { from: 'dup', to: 'client', label: 'no' },
    { from: 'client', to: 'txn', label: 'yes' },
    { from: 'txn', to: 'voucher' },
    { from: 'voucher', to: 'db', label: 'commit' },
    { from: 'db', to: 'event', label: 'after commit' },
    { from: 'event', to: 'jobs' },
    { from: 'event', to: 'stock' },
    { from: 'event', to: 'push' },
    { from: 'dup', to: 'dupno', label: 'yes' },
    { from: 'client', to: 'clientno', label: 'no' },
    { from: 'voucher', to: 'rollback', label: 'fails' },
    { from: 'push', to: 'phone', label: 'worker sends' },
  ],
  steps: [
    {
      label: 'Good record',
      flow: [
        { edges: 'app->dup', say: 'The app sends a record. The server checks it is new.' },
        { edges: ['dup->client', 'client->txn'], say: 'The client is allowed. The server opens one transaction.' },
        { edges: ['txn->voucher', 'voucher->db'], say: 'All three rows commit together.' },
        {
          edges: ['db->event', 'event->jobs', 'event->stock', 'event->push'],
          say: 'Listeners update jobs and stock, and queue a push.',
        },
        { edges: 'push->phone', say: 'A worker sends the push to the phones.' },
      ],
    },
    {
      label: 'Sent twice',
      flow: [
        { edges: 'app->dup', say: 'The app sends a record it sent before.' },
        { edges: 'dup->dupno', say: 'The server finds it and answers DUPLICATE. Nothing is saved twice.' },
      ],
    },
    {
      label: 'Expired certification',
      flow: [
        { edges: ['app->dup', 'dup->client'], say: 'The record is new.' },
        { edges: 'client->clientno', say: 'The certification expired. The server refuses the record.' },
      ],
    },
    {
      label: 'No disclaimer',
      flow: [
        { edges: ['app->dup', 'dup->client', 'client->txn', 'txn->voucher'], say: 'The rows wait inside the transaction.' },
        { edges: 'voucher->rollback', say: 'The voucher fails. Every row rolls back. No table changes.' },
      ],
    },
  ],
};

export default {
  title: 'The worker app syncs a collection',
  props,
} satisfies Figure;
