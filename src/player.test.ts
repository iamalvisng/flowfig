import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { FlowProps } from './model.ts';

// Node strips types but not JSX, so the player is tested from the build (`npm test` builds first).
// Server markup covers the first frame only; clicks and the clock need a DOM.
const { Flow } = await import(new URL('../dist/index.js', import.meta.url).href);
const render = (props: FlowProps) => renderToString(createElement(Flow, props));

const fig: FlowProps = {
  layout: {
    children: [
      { id: 'client', label: 'Browser' },
      { id: 'db', label: 'Database', shape: 'store' },
    ],
  },
  edges: [{ id: 'q', from: 'client', to: 'db', label: 'query' }],
  steps: [
    { label: 'miss', flow: [{ edges: 'q', say: 'The browser asks.' }] },
    { label: 'hit', flow: ['q'] },
  ],
};

test('draws every box, and leaves the edges until the boxes are measured', () => {
  const html = render(fig);
  for (const text of ['Browser', 'Database']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('query'));
});

test('gives one tab per step and selects the first', () => {
  const tabs = [...render(fig).matchAll(/role="tab" aria-selected="(true|false)"[^>]*>(\w+)/g)];
  assert.deepEqual(
    tabs.map(([, on, label]) => [label, on]),
    [
      ['miss', 'true'],
      ['hit', 'false'],
    ],
  );
});

test('plays on load unless autoplay is off', () => {
  assert.match(render(fig), /aria-label="Pause"/);
  assert.match(render({ ...fig, autoplay: false }), /aria-label="Play"/);
});

test('starts at 1× speed', () => {
  assert.match(render(fig), /aria-label="Speed 1×, switch to 2×"/);
});

test('a figure with no steps has no controls', () => {
  const html = render({ ...fig, steps: [] });
  assert.ok(html.includes('Browser'));
  assert.match(html, />Browser<\/div>/);
  assert.doesNotMatch(html, /role="tablist"|aria-label="Pause"/);
});

test('a row gap grows to hold a long edge label', () => {
  const long = 'a-long-monospace-label';
  const html = render({ ...fig, edges: [{ id: 'q', from: 'client', to: 'db', label: long }], steps: [] });
  const gaps = [...html.matchAll(/gap:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...gaps) >= long.length * 11 * 0.6 + 14 + 16 - 0.1, `gaps ${gaps}`);
});

const railFig: FlowProps = {
  ...fig,
  rail: true,
  steps: [
    {
      label: 'miss',
      flow: [{ edges: { edge: 'q', data: 'SELECT user' } }, { edges: { edge: 'q', back: true, async: true } }],
    },
  ],
};

test('rail: the server markup shows one row per message, and the first message is now', () => {
  const html = render(railFig);
  assert.equal(html.match(/data-rail-row="/g)?.length, 2);
  assert.match(html, /data-rail-row="1"[^>]*data-state="now"/);
  assert.match(html, /data-rail-row="2"[^>]*data-state="next"/);
  assert.match(html, /SELECT user/);
  assert.match(html, /ASYNC/);
});

test('no rail without rail: true', () => {
  assert.doesNotMatch(render(fig), /data-rail-row/);
});

test("rail: 'only' draws the rail rows, the tabs and no map", () => {
  const html = render({ ...railFig, rail: 'only' });
  assert.equal(html.match(/data-rail-row="/g)?.length, 2);
  assert.doesNotMatch(html, /data-fig=/);
  assert.match(html, /role="tablist"/);
});

test('a lit box has the trail look on load, and the style holds the active look', () => {
  const html = render(fig);
  // trail: 1 px accent border, no glow
  assert.ok(html.includes('border:1px solid var(--fig-accent'), 'trail border');
  assert.ok(!html.replace(/<style>.*?<\/style>/, '').includes('0 0 0 3px'), 'no glow on the trail');
  // active: the class the tick toggles has a 2 px border and the glow
  assert.match(html, /\.flowfig-active[^{]*\{[^}]*border-width:2px[^}]*box-shadow:0 0 0 3px/);
});

test('a toned box has the tone border and tint in the server markup', () => {
  const html = render({
    ...fig,
    layout: {
      children: [
        { id: 'client', label: 'Browser', tone: 'red' },
        { id: 'db', label: 'Database' },
      ],
    },
  });
  assert.ok(html.includes('border:1px solid #ef4444'), 'tone border');
  assert.ok(html.includes('color-mix(in srgb, #ef4444 8%'), 'tone tint');
});

const lanesFig: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        id: 'customer',
        label: 'Customer',
        children: [
          { id: 'ask', label: 'Request refund' },
          { id: 'get', label: 'Get money' },
        ],
      },
      {
        id: 'support',
        label: 'Support',
        children: [
          { id: 'check', label: 'Check order' },
          { id: 'reject', label: 'Reject' },
        ],
      },
      {
        id: 'finance',
        label: 'Finance',
        children: [
          { id: 'pay', label: 'Issue refund' },
          { id: 'audit', label: 'Audit', at: 1 },
        ],
      },
    ],
  },
  edges: [
    { id: 'a', from: 'ask', to: 'check' },
    { id: 'b', from: 'check', to: 'pay' },
    { id: 'c', from: 'pay', to: 'get' },
    { id: 'r', from: 'check', to: 'reject' },
  ],
  steps: [
    { label: 'ok', flow: ['a', 'b', { edge: 'c', back: true }] },
    { label: 'no', flow: ['a', 'r'] },
  ],
};

test('lanes: the player renders a grid with one band per lane and a grid column per box', () => {
  const html = render(lanesFig);
  assert.match(html, /grid-template-columns:\s*max-content repeat\(\d+,\s*max-content\)/);
  assert.equal((html.match(/data-fig-lane/g) ?? []).length, 3);
  assert.match(html, /grid-column:\s*3[^>]*><div data-fig="check"/);
  assert.match(html, /grid-column:\s*3[^>]*><div data-fig="audit"/);
  assert.match(html, /Customer/);
});

test('lanes: the last time column keeps 18 px on the right, and a box at the top does not crash', () => {
  const html = render(lanesFig);
  assert.match(html, /padding:24px 18px 24px 0[^>]*><div data-fig="reject"/);
  assert.match(html, /padding:24px 56px 24px 0[^>]*><div data-fig="check"/);
  assert.doesNotThrow(() => render({ lanes: true, layout: { direction: 'row', children: [{ id: 'a', label: 'A' }] }, edges: [] }));
});
