import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOKS, edgeId, nodes, str } from './model.ts';
import { cast } from './explain.ts';
import { scene } from './world.ts';
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
