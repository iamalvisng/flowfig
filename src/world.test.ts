import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOKS, edgeId, nodes, str } from './model.ts';
import type { FlowProps } from './model.ts';
import { cast } from './explain.ts';
import { scene, timeline } from './world.ts';
import type { Ev } from './world.ts';
import oil from '../figures/explain-oil.ts';
import returns from '../figures/returns-process.ts';
import checkout from '../figures/checkout.ts';
import sync from '../figures/explain-sync.ts';
import deliveryBefore from '../figures/explain-delivery-before.ts';
import deliveryAfter from '../figures/explain-delivery-after.ts';

const FIGURES = [oil, returns, checkout, sync, deliveryBefore, deliveryAfter];

test('the world scene code holds no word from any figure', () => {
  const FIELDS = ['label', 'from', 'to', 'id', 'check', 'carries', 'thing', 'form', 'count', 'outcome', 'look', 'tone'];
  const stop = new Set<string>([...LOOKS, ...FIELDS, 'shape', 'data', 'box', 'barrel', 'notes', 'edges', 'steps', 'say', 'note']);
  const terms = new Set<string>();
  const add = (v: unknown) => {
    const t = str(v).trim().toLowerCase();
    if (t && !stop.has(t)) terms.add(t);
  };
  for (const { props: p } of FIGURES) {
    for (const n of nodes(p.layout)) [n.id, n.label].forEach(add);
    for (const a of cast(p)) add(a.name);
    for (const e of p.edges) [edgeId(e), e.label, typeof e.carries === 'object' ? e.carries.thing : ''].forEach(add);
    for (const s of p.steps ?? []) add(s.label);
  }
  const hits: string[] = [];
  for (const file of ['world.ts', 'world-art.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const [lit] of src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
      const low = lit.toLowerCase();
      const words = new Set(low.match(/[\p{L}\d][\p{L}\d-]*/gu) ?? []);
      for (const t of terms)
        if (/^[\p{L}\d]+$/u.test(t) ? words.has(t) : low.includes(t)) hits.push(`${file}: "${t}" in ${lit.slice(0, 50)}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('a thing starts at the actor of its carries.from box or group, with 1 to 4 units', () => {
  const sc = scene({
    ...returns.props,
    edges: returns.props.edges.map((e) =>
      e.id === 'arrive' ? { ...e, carries: { thing: 'item', form: 'crate' as 'box', count: 9, from: 'customer' } } : e,
    ),
  });
  const hop = sc.stories[0].moments.flat().find((h) => h.edge === 'arrive')!;
  assert.deepEqual(hop.carry, { thing: 'item', form: 'box', count: 4, from: sc.actors.findIndex((a) => a.name === 'Customer') });
  assert.deepEqual(sc.things.get('item'), { form: 'box', count: 4 });
});

test('the device comes from the look, and only an antenna actor has a roof antenna', () => {
  const mark = 'fill="#ffffff" stroke="#2456D6"';
  const expected = [
    { fig: oil, devices: ['phone', 'antenna', 'cab', 'antenna'], antennas: 2 },
    { fig: returns, devices: ['phone', 'antenna', 'antenna', 'antenna'], antennas: 3 },
  ];
  for (const { fig, devices, antennas } of expected) {
    const sc = scene(fig.props);
    assert.deepEqual(
      sc.actors.map((a) => a.device),
      devices,
    );
    assert.equal(sc.svg.split(mark).length - 1, antennas);
    for (const a of sc.actors) {
      if (a.device !== 'antenna') assert.equal(a.lot.roof, null, a.name);
      else assert.ok(Math.min(...a.lot.hull.map((p) => p[1])) <= a.lot.roof![1], a.name);
    }
  }
  assert.equal(scene(oil.props).truck, 2);
  assert.ok(scene(oil.props).truckArt);
});

test('hops start in cause order', () => {
  const sc = scene(oil.props);
  const story = (name: string) => sc.stories.findIndex((s) => s.name === name);
  const first = (evs: Ev[], hop: number) => Math.min(...evs.filter((e) => e.hop === hop).map((e) => e.start));
  const last = (evs: Ev[], hop: number) => Math.max(...evs.filter((e) => e.hop === hop).map((e) => e.end));
  const chain = timeline(sc, story('Normal pickup'), 2).events;
  assert.ok(chain.some((e) => e.hop === 0) && chain.some((e) => e.hop === 1));
  assert.ok(first(chain, 1) >= last(chain, 0), 'assign->collect waits for free->assign');
  const pair = timeline(sc, story('Normal pickup'), 5).events;
  assert.equal(first(pair, 0), first(pair, 1), 'save->stock and save->cash start together');
  const refused = timeline(sc, story('Expired certification'), 2).events;
  const fail = refused.find((e) => e.kind === 'fail')!;
  const reply = refused.find((e) => e.kind === 'reply')!;
  assert.equal(fail.start, last(refused, 0), 'the gate turns red when the pulse arrives');
  assert.ok(reply.start >= fail.end, 'the red reply starts after the gate turns red');
  for (const evs of [chain, pair, refused]) {
    const cam = evs.find((e) => e.kind === 'camera')!;
    assert.ok(
      evs.every((e) => e === cam || e.start >= cam.end),
      'the camera ends before the first hop',
    );
  }
});

test('a hop to a box outside every actor moves nothing and stops nothing', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { label: 'Shop', look: 'shop', children: [{ id: 'a', label: 'Sell' }] },
        { id: 'q', label: 'Paid?', shape: 'decision' },
        { label: 'Bank', children: [{ id: 'b', label: 'Book' }] },
      ],
    },
    edges: [
      { from: 'a', to: 'q' },
      { from: 'a', to: 'b' },
    ],
    steps: [{ label: 'Sell', flow: [{ edges: ['a->q', 'a->b'] }] }],
  };
  const sc = scene(fig);
  const { events } = timeline(sc, 0, 0);
  assert.ok(!events.some((e) => e.hop === 0));
  assert.ok(events.some((e) => e.hop === 1 && e.kind === 'pulse'));
});
