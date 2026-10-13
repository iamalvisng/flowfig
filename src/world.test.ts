import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOKS, edgeId, nodes, str, type FlowProps } from './model.ts';
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
    const t = str(v).trim();
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
      const words = new Set(lit.match(/[\p{L}\d][\p{L}\d-]*/gu) ?? []);
      for (const t of terms)
        if (/^[\p{L}\d]+$/u.test(t) ? words.has(t) : lit.includes(t)) hits.push(`${file}: "${t}" in ${lit.slice(0, 50)}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the scene keeps spec text out of the drawing, so a label cannot add markup', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const fig: FlowProps = {
    lanes: true,
    layout: {
      direction: 'column',
      children: [
        { label: bad, look: 'person', children: [{ id: 'a', label: bad, check: bad }] },
        { label: 'B', children: [{ id: 'b', label: bad }] },
      ],
    },
    edges: [{ from: 'a', to: 'b', label: bad, carries: { thing: bad } }],
    steps: [{ label: bad, outcome: bad, flow: [{ edges: { edge: 'a->b', data: bad }, say: bad }] }],
  };
  const sc = scene(fig);
  assert.ok(!sc.svg.includes('<img') && !sc.svg.includes('onerror'));
  assert.equal(sc.boxes.a.label, bad);
  assert.equal(sc.stories[0].moments[0][0].label, bad);
  assert.equal(sc.actors.length, 2);
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
  assert.deepEqual(sc.things.item, { form: 'box', count: 4 });
});

test('the device comes from the look, and the antenna tip stays inside the hull', () => {
  const sc = scene(oil.props);
  for (const a of sc.actors) {
    const want = a.look === 'truck' ? 'cab' : a.look === 'person' || a.look === 'phone' ? 'phone' : 'antenna';
    assert.equal(a.device, want, a.name);
    const [rx, ry] = a.lot.roof;
    const h = a.lot.hull;
    const sides = h.map(([x, y], i) => {
      const [nx, ny] = h[(i + 1) % h.length];
      return (nx - x) * (ry - y) - (ny - y) * (rx - x);
    });
    assert.ok(sides.every((c) => c >= -1) || sides.every((c) => c <= 1), `${a.name}: the roof point is outside the hull`);
  }
  assert.equal(
    sc.truck,
    sc.actors.findIndex((a) => a.look === 'truck'),
  );
  assert.ok(sc.truckArt);
});
