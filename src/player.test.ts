import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { FlowProps } from './model.ts';

// Server markup shows the first frame only; clicks and the clock need a DOM.
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

test("rail: 'only' draws the rail rows, the tabs and no map", () => {
  const html = render({ ...railFig, rail: 'only' });
  assert.equal(html.match(/data-rail-row="/g)?.length, 2);
  assert.doesNotMatch(html, /data-fig=/);
  assert.match(html, /role="tablist"/);
});

test('a lit box has the trail look on load, and the style holds the active look', () => {
  const html = render(fig);
  assert.ok(html.includes('border:1px solid var(--fig-accent'), 'trail border');
  assert.ok(!html.replace(/<style>.*?<\/style>/, '').includes('0 0 0 3px'), 'no glow on the trail');
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
  assert.match(html, /grid-template-columns:\s*[\d.]+px repeat\(\d+,\s*max-content\)/);
  assert.equal((html.match(/data-fig-lane/g) ?? []).length, 5);
  assert.match(html, /grid-column:\s*3[^>]*><div data-fig="check"/);
  assert.match(html, /grid-column:\s*3[^>]*><div data-fig="audit"/);
  assert.match(html, /Customer/);
});

test('lanes: the last time column keeps 18 px on the right, and a box at the top does not crash', () => {
  const html = render(lanesFig);
  assert.match(html, /padding:24px 18px 24px [\d.]+px[^>]*><div data-fig="reject"/);
  assert.match(html, /padding:24px 56px 24px 0[^>]*><div data-fig="ask"/);
  assert.ok(Number(/padding:24px ([\d.]+)px[^>]*><div data-fig="check"/.exec(html)![1]) > 56);
  assert.doesNotThrow(() => render({ lanes: true, layout: { direction: 'row', children: [{ id: 'a', label: 'A' }] }, edges: [] }));
});

test('marks: the server markup has a start dot and an end ring', () => {
  const html = render({
    ...fig,
    layout: {
      children: [
        { id: 'client', label: 'Browser', mark: 'start' },
        { id: 'db', label: 'Database', mark: 'end' },
      ],
    },
  });
  assert.ok(html.includes('left:-18px;width:10px;height:10px'));
  assert.ok(html.includes('right:-20px;width:14px;height:14px'));
  assert.ok(!render(fig).includes('width:14px;height:14px'));
});

const tlFig: FlowProps = {
  timeline: true,
  today: '2026-10-14',
  layout: {
    direction: 'column',
    children: [
      {
        id: 'prod',
        label: 'Product',
        children: [
          { id: 'spec', label: 'Spec', from: '2026-10-05', to: '2026-10-16' },
          { id: 'build', label: 'Build', from: '2026-10-19', to: '2026-11-06' },
        ],
      },
      { id: 'launch', label: 'Launch', children: [{ id: 'ga', label: 'GA', from: '2026-11-09' }] },
    ],
  },
  edges: [{ from: 'spec', to: 'build' }],
};

test('timeline: the server markup has the bars, the axis ticks and the today line, and no tab row', () => {
  const html = render(tlFig);
  for (const id of ['spec', 'build', 'ga']) assert.ok(html.includes(`data-fig="${id}"`), id);
  assert.ok(html.includes('data-fig-axis') && html.includes('>W41<'), 'axis ticks');
  assert.ok(html.includes('data-fig-today') && html.includes('>today<'), 'today marker');
  assert.ok(html.includes('data-fig-playhead') && />\d+ [A-Z][a-z]{2}</.test(html), 'playhead with a date label');
  assert.ok(html.includes('data-diamond="true"'), 'milestone');
  assert.ok(!html.includes('class="flowfig-active'), 'the focus look comes from the tick, so the server markup has no active box');
  assert.ok(html.includes('aria-label="Pause"') && !html.includes('role="tablist"'), 'play control, no tabs');
  assert.ok(
    render({ ...tlFig, steps: [{ label: 'walk', flow: [{ light: ['spec'] }] }] }).includes('role="tablist"'),
    'own steps keep the tabs',
  );
});

test('timeline: on the first mount the playhead is at the first item, and the lines sit behind the bars', async () => {
  const { timelineLayout, loopStartItem, timelineBeats, TL_AXIS_W } = await import('./model.ts');
  const html = render(tlFig);
  const lay = timelineLayout(tlFig, TL_AXIS_W);
  const first = loopStartItem(lay.items, timelineBeats(tlFig))!;
  assert.equal(first.id, 'spec');
  const line = html.indexOf('data-fig-playhead');
  assert.ok(html.slice(line, line + 400).includes(`translateX(${first.x}px)`), 'the line starts at the first item');
  assert.ok(line < html.indexOf('data-fig="spec"') && html.indexOf('data-fig-today') < html.indexOf('data-fig="spec"'), 'lines first');
  assert.ok(html.lastIndexOf('>today<') > html.indexOf('data-fig="ga"'), 'the today label is on top');
  assert.ok(html.lastIndexOf(`>${first.date}<`) > html.indexOf('data-fig="ga"'), 'the date label is on top');
});

test('lanes wrap: the player shows the blocks of the SVG, each with its own lanes', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  const { lanePlan, nodes } = await import('./model.ts');
  const html = render(demo.props);
  const blocks = html.split(/data-fig-block="\d+"/).slice(1);
  assert.equal(blocks.length, 2);
  const lanes = (b: string) => [...b.matchAll(/data-fig-gutter=""[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(lanes(blocks[0]), ['Customer', 'Support']);
  assert.deepEqual(lanes(blocks[1]), ['Support', 'Warehouse', 'Finance']);
  const { cols, per } = lanePlan(demo.props);
  for (const n of nodes(demo.props.layout))
    assert.ok(blocks[Math.floor(cols.get(n.id)! / per)].includes(`data-fig="${n.id}"`), `${n.id} sits in the SVG's block`);
  assert.match(html, /grid-auto-rows:minmax\(86px, auto\)/);
});

test('lanes wrap: every block has the gutter of the plan, and an empty block is not drawn', async () => {
  const { default: demo } = await import('../figures/returns-process.ts');
  const { lanePlan } = await import('./model.ts');
  const html = render(demo.props);
  const gutters = [...html.matchAll(/data-fig-block="\d+" style="display:grid;grid-template-columns:([\d.]+)px/g)].map((m) => +m[1]);
  assert.deepEqual(gutters, [lanePlan(demo.props).gutter, lanePlan(demo.props).gutter]);
  const far = structuredClone(demo.props);
  (far.layout.children[1] as { children: { id: string; at?: number }[] }).children.find((b) => b.id === 'rejected')!.at = 20;
  const blocks = [...render(far).matchAll(/data-fig-block="(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(blocks, lanePlan(far).blocks);
});
