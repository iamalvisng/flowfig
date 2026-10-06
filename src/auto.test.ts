import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGroup, nodes, str, type FigGroup, type FlowProps } from './model.ts';
import { check, render } from './svg.ts';

const SPECS: Record<string, FlowProps> = {
  runA: {
    layout: {
      auto: true,
      children: [
        { id: 'req', label: 'API request', sub: 'worker creates collection' },
        { id: 'sync', label: 'Phone sync push', sub: 'offline record' },
        { id: 'core', label: 'Create collection', sub: 'one transaction' },
        { id: 'sig', label: 'Signature uploaded?', shape: 'decision' },
        { id: 'ins', label: 'Insert collection', sub: 'reference number, review flag' },
        { id: 'col', label: 'Collections', shape: 'store' },
        { id: 'aud', label: 'Audit records', sub: 'SHA-256 hash', shape: 'store' },
        { id: 'cli', label: 'Client row', sub: 'price per kg, consent', shape: 'store' },
        { id: 'pv', label: 'Create voucher', sub: 'PV number, price, settlement' },
        { id: 'pvt', label: 'Payment vouchers', shape: 'store' },
      ],
    },
    edges: [
      { id: 'r', from: 'req', to: 'core', label: 'create' },
      { id: 's', from: 'sync', to: 'core', label: 'create' },
      { id: 'c', from: 'core', to: 'sig', label: 'check' },
      { id: 'i', from: 'sig', to: 'ins', label: 'yes' },
      { id: 'w', from: 'ins', to: 'col', label: 'insert row' },
      { id: 'a', from: 'ins', to: 'aud', label: 'if audit eligible' },
      { id: 'k', from: 'core', to: 'cli', label: 'if new price' },
      { id: 'v', from: 'core', to: 'pv', label: 'same transaction' },
      { id: 'p', from: 'pv', to: 'pvt', label: 'insert voucher' },
    ],
    steps: [
      {
        label: 'Create',
        flow: [
          { edges: ['r', 's'] },
          { edges: 'c' },
          { edges: 'i' },
          { edges: ['w', 'a'] },
          { edges: 'k' },
          { edges: 'v' },
          { edges: 'p' },
        ],
      },
    ],
  },
  runB: {
    layout: {
      auto: true,
      children: [
        { id: 'ctrl', label: 'POST /collections', sub: 'worker, manager or admin' },
        { id: 'create', label: 'Check client and job order' },
        { id: 'event', label: 'Announce collection', sub: 'after commit' },
        { id: 'reject', label: 'Reject: signature missing' },
        { id: 'sig', label: 'Signature uploaded?', shape: 'decision' },
        { id: 'insert', label: 'Insert collection', sub: 'reference, review flag, consent' },
        { id: 'rate', label: 'Save supplier rate', sub: 'client row and activity log' },
        { id: 'coll', label: 'Collection', shape: 'store' },
        { id: 'audit', label: 'Audit record', shape: 'store' },
        { id: 'pv', label: 'Create payment voucher', sub: 'PV number, price per kg' },
        { id: 'pvt', label: 'Payment voucher', shape: 'store' },
      ],
    },
    edges: [
      { id: 'e1', from: 'ctrl', to: 'create', label: 'dto' },
      { id: 'e2', from: 'create', to: 'sig', label: 'create in one transaction' },
      { id: 'e3', from: 'sig', to: 'reject', label: 'no' },
      { id: 'e4', from: 'sig', to: 'insert', label: 'yes' },
      { id: 'e5', from: 'insert', to: 'coll', label: 'insert row' },
      { id: 'e6', from: 'insert', to: 'audit', label: 'if audit eligible: hash v5' },
      { id: 'e7', from: 'sig', to: 'rate', label: 'if rate sent' },
      { id: 'e8', from: 'sig', to: 'pv', label: 'same transaction' },
      { id: 'e9', from: 'pv', to: 'pvt', label: 'insert voucher' },
      { id: 'e10', from: 'create', to: 'event', label: 'collection.created' },
    ],
    steps: [
      { label: 'Signature present', flow: ['e1', 'e2', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', { edges: [{ edge: 'e10', async: true }] }] },
      { label: 'Signature missing', flow: ['e1', 'e2', { edges: [{ edge: 'e3' }] }] },
    ],
  },
  cached: {
    layout: {
      auto: true,
      children: [
        { id: 'client', label: 'Browser', sub: 'the caller' },
        { label: 'Backend', gap: 36, children: [{ id: 'api', label: 'API Server', sub: 'handles the request', width: 200 }] },
        {
          label: 'Storage',
          gap: 36,
          children: [
            { id: 'cache', label: 'Cache', sub: 'in memory', shape: 'store', width: 200 },
            { id: 'db', label: 'Database', sub: 'source of truth', shape: 'store', width: 200 },
          ],
        },
      ],
    },
    edges: [
      { id: 'req', from: 'client', to: 'api', label: 'request' },
      { id: 'get', from: 'api', to: 'cache', label: 'get' },
      { id: 'query', from: 'api', to: 'db', label: 'query' },
    ],
    steps: [
      {
        label: 'cache miss',
        flow: [
          { edges: { edge: 'req', data: 'GET /users/42' }, show: { client: [{ tag: 'GET', text: '/users/42', mono: true }] } },
          { edges: { edge: 'get' }, show: { cache: [{ text: 'users:42', mono: true, mark: 'miss' }] } },
          { edges: 'query', show: { db: [{ tag: 'row', text: 'Ada Lovelace', mark: 'read' }] } },
          {
            edges: [
              { edge: 'get', data: 'set' },
              { edge: 'req', back: true, data: '200 OK' },
            ],
            show: { cache: [{ text: 'users:42', mono: true, mark: 'stored' }] },
          },
        ],
      },
      {
        label: 'cache hit',
        flow: [
          { edges: { edge: 'req', data: 'GET /users/42' }, show: { client: [{ tag: 'GET', text: '/users/42', mono: true }] } },
          { edges: { edge: 'get' }, show: { cache: [{ text: 'users:42', mono: true, mark: 'hit' }] } },
          { edges: { edge: 'req', back: true, data: '200 OK' } },
        ],
      },
    ],
  },
  checkout: {
    rail: true,
    layout: {
      auto: true,
      children: [
        { id: 'browser', label: 'Browser' },
        { label: 'Edge', children: [{ id: 'gateway', label: 'Gateway' }] },
        {
          label: 'Order service',
          gap: 36,
          children: [
            { id: 'orders', label: 'Orders', width: 160 },
            { id: 'db', label: 'Orders DB', shape: 'store', width: 160 },
          ],
        },
        { label: 'External', children: [{ id: 'payments', label: 'Payments' }] },
      ],
    },
    edges: [
      { id: 'submit', from: 'browser', to: 'gateway', label: 'checkout' },
      { id: 'create', from: 'gateway', to: 'orders', label: 'create' },
      { id: 'charge', from: 'orders', to: 'payments', label: 'charge' },
      { id: 'insert', from: 'orders', to: 'db', label: 'save the order' },
    ],
    steps: [
      { label: 'submit', flow: [{ edges: { edge: 'submit', data: '3 items · $42.00' } }, { edges: 'create' }] },
      {
        label: 'pay',
        flow: [
          {
            edges: [
              { edge: 'charge', data: 'charge $42.00' },
              { edge: 'insert', data: 'order #981' },
            ],
          },
          { edges: { edge: 'charge', back: true, async: true, data: 'webhook: paid' } },
          { edges: { edge: 'submit', back: true, data: '201 Created' } },
        ],
      },
    ],
  },
  first: {
    layout: {
      auto: true,
      children: [
        { id: 'browser', label: 'Browser' },
        { id: 'api', label: 'API' },
        { id: 'db', label: 'Database', shape: 'store' },
      ],
    },
    edges: [
      { from: 'browser', to: 'api', label: 'GET /user' },
      { from: 'api', to: 'db', label: 'read the user' },
    ],
    steps: [
      {
        label: 'Load a user',
        flow: [
          { edges: 'browser->api' },
          { edges: 'api->db' },
          { edges: { edge: 'api->db', back: true } },
          { edges: { edge: 'browser->api', back: true } },
        ],
      },
    ],
  },
  hero: {
    rail: true,
    layout: {
      auto: true,
      children: [
        { id: 'you', label: 'You' },
        { id: 'agent', label: 'Coding agent', sub: 'Claude Code, Cursor' },
        { id: 'code', label: 'Your code', shape: 'store' },
        { id: 'flowfig', label: 'flowfig', sub: 'check, then render' },
        { id: 'readme', label: 'README.md', shape: 'store' },
      ],
    },
    edges: [
      { id: 'ask', from: 'you', to: 'agent', label: 'ask' },
      { id: 'read', from: 'agent', to: 'code', label: 'read' },
      { id: 'spec', from: 'agent', to: 'flowfig', label: 'spec' },
      { id: 'svg', from: 'flowfig', to: 'readme', label: 'SVG' },
    ],
    steps: [
      {
        label: 'read',
        flow: [
          { edges: { edge: 'ask', data: 'draw how login works' } },
          { edges: { edge: 'read', data: 'src/auth/login.ts' } },
          { edges: { edge: 'read', back: true, data: '3 parts, 4 calls' } },
        ],
      },
      {
        label: 'check',
        flow: [
          { edges: { edge: 'spec', data: 'login.json' } },
          { edges: { edge: 'spec', back: true, data: 'error: text-overflow' } },
          { edges: { edge: 'spec', data: 'fixed spec' } },
          { edges: { edge: 'svg', data: 'login.svg' } },
        ],
      },
    ],
  },
  orderStatus: {
    layout: {
      auto: true,
      children: [
        { id: 'new', label: 'New', mark: 'start' },
        { id: 'paid', label: 'Paid' },
        { id: 'shipped', label: 'Shipped' },
        { id: 'delivered', label: 'Delivered', mark: 'end' },
        { id: 'cancelled', label: 'Cancelled', mark: 'end' },
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
      { label: 'delivered', flow: [{ edges: 'pay' }, { edges: 'ship' }, { edges: { edge: 'deliver' } }] },
      { label: 'cancelled', flow: [{ edges: 'pay' }, { edges: { edge: 'cancel-paid' } }] },
    ],
  },
};

const LAYOUT_RULES = ['edge-crosses-box', 'long-edge', 'small-text'];

test('run A, run B and the README maps in the auto form draw with no crossing, detour or small text', () => {
  for (const [name, fig] of Object.entries(SPECS))
    assert.deepEqual(
      check(fig).filter((f) => LAYOUT_RULES.includes(f.rule)),
      [],
      name,
    );
});

test('a retry edge back to the queue does not move the queue off the top', () => {
  const fig: FlowProps = {
    layout: {
      auto: true,
      children: [
        { id: 'dlq', label: 'Dead letters', shape: 'store' },
        { id: 'done', label: 'Done', shape: 'store' },
        { id: 'ok', label: 'Succeeded?', shape: 'decision' },
        { id: 'w', label: 'Worker' },
        { id: 'q', label: 'Queue' },
      ],
    },
    edges: [
      { id: 'a', from: 'q', to: 'w', label: 'pull' },
      { id: 'b', from: 'w', to: 'ok' },
      { id: 'c', from: 'ok', to: 'done', label: 'yes' },
      { id: 'r', from: 'ok', to: 'q', label: 'retry' },
      { id: 'd', from: 'ok', to: 'dlq', label: '3rd fail' },
    ],
    steps: [{ label: 'Run', flow: ['a', 'b', 'r', 'a', 'b', 'c'] }],
  };
  const { boxes } = render(fig).scene;
  const q = boxes.find((b) => b.id === 'q')!.rect;
  for (const b of boxes) if (b.id !== 'q') assert.ok(b.rect.y > q.y + q.h, `${b.id} is under the queue`);
  assert.deepEqual(check(fig), []);
});

test('a labeled frame holds its own boxes and no other box', () => {
  for (const name of ['checkout', 'cached']) {
    const fig = SPECS[name];
    const { svg, scene } = render(fig);
    const frames = [
      ...svg.matchAll(
        /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="14"[^>]*\/><text[^>]*class="frame">([^<]+)</g,
      ),
    ];
    const groups = fig.layout.children.filter(isGroup) as FigGroup[];
    assert.equal(frames.length, groups.length, name);
    for (const g of groups) {
      const [, x, y, w, h] = frames.find((m) => m[5] === str(g.label).toUpperCase())!.map(Number);
      const members = new Set(nodes(g).map((n) => n.id));
      for (const b of scene.boxes) {
        const r = b.rect;
        const inside = r.x >= x && r.y >= y && r.x + r.w <= x + w && r.y + r.h <= y + h;
        assert.equal(inside, members.has(b.id), `${name}: box ${b.id} and frame ${str(g.label)}`);
      }
    }
  }
});
