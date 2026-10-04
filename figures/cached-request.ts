import type { Figure, FigRow } from '../src';

// An example figure: one read request, first as a cache miss, then as a cache hit.

const USER: FigRow = { tag: 'GET', tone: 'blue', text: '/users/42', mono: true };

const props: Figure['props'] = {
  layout: {
    gap: 44,
    children: [
      { id: 'client', label: 'Browser', sub: 'the caller' },
      {
        label: 'Backend',
        direction: 'column',
        gap: 36,
        children: [{ id: 'api', label: 'API Server', sub: 'handles the request', width: 200, source: 'examples/shop/api.ts#getUser' }],
      },
      {
        label: 'Storage',
        direction: 'column',
        gap: 36,
        children: [
          { id: 'cache', label: 'Cache', sub: 'in memory', shape: 'store', width: 200, source: 'examples/shop/cache.ts#getCached' },
          { id: 'db', label: 'Database', sub: 'source of truth', shape: 'store', width: 200, source: 'examples/shop/db.ts#queryUser' },
        ],
      },
    ],
  },
  edges: [
    { id: 'req', from: 'client', to: 'api', label: 'request' },
    { id: 'get', from: 'api', to: 'cache', label: 'get', source: 'examples/shop/api.ts#getUser' },
    { id: 'query', from: 'api', to: 'db', label: 'query', source: 'examples/shop/api.ts#getUser' },
  ],
  steps: [
    {
      label: 'cache miss',
      flow: [
        { edges: { edge: 'req', data: 'GET /users/42' }, show: { client: [USER] }, say: 'The browser asks for user 42.' },
        {
          edges: { edge: 'get', tone: 'orange' },
          show: { cache: [{ text: 'users:42', mono: true, mark: 'miss' }] },
          say: 'The API server checks the cache first. The cache has no entry.',
        },
        {
          edges: 'query',
          show: { db: [{ tag: 'row', tone: 'gray', text: 'Ada Lovelace', mark: 'read' }] },
          say: 'The API server reads the row from the database.',
        },
        {
          edges: [
            { edge: 'get', data: 'set' },
            { edge: 'req', back: true, data: '200 OK' },
          ],
          show: { cache: [{ text: 'users:42', mono: true, mark: 'stored' }] },
          say: 'The API server stores the row in the cache and sends the response.',
        },
      ],
    },
    {
      label: 'cache hit',
      flow: [
        { edges: { edge: 'req', data: 'GET /users/42' }, show: { client: [USER] }, say: 'The browser asks for user 42 again.' },
        {
          edges: { edge: 'get', tone: 'green' },
          show: { cache: [{ text: 'users:42', mono: true, mark: 'hit' }] },
          say: 'The cache has the entry now.',
        },
        {
          edges: { edge: 'req', back: true, data: '200 OK' },
          say: 'The API server sends the response. The database gets no query.',
        },
      ],
    },
  ],
};

export default {
  title: 'Cached request',
  props,
} satisfies Figure;
