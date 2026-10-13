import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOKS, edgeId, nodes, str } from './model.ts';
import type { FlowProps } from './model.ts';
import { cast } from './explain.ts';
import { HUD } from './looks.ts';
import { hit, place, polyHit, scene, stageFor, stateAt, timeline } from './world.ts';
import type { Ev, Placed, Pt, Rect, Stage } from './world.ts';
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

test('hops start in cause order, and a gate shows its question, then its answer, then the result', () => {
  const sc = scene(oil.props);
  const story = (name: string) => sc.stories.findIndex((s) => s.name === name);
  const first = (evs: Ev[], hop: number) => Math.min(...evs.filter((e) => e.hop === hop).map((e) => e.start));
  const last = (evs: Ev[], hop: number) => Math.max(...evs.filter((e) => e.hop === hop).map((e) => e.end));
  const one = (evs: Ev[], kind: Ev['kind'], hop: number) => evs.find((e) => e.kind === kind && e.hop === hop)!;
  const chain = timeline(sc, story('Normal pickup'), 2).events;
  assert.ok(chain.some((e) => e.hop === 0) && chain.some((e) => e.hop === 1));
  assert.ok(first(chain, 1) >= last(chain, 0), 'assign->collect waits for free->assign');
  const pair = timeline(sc, story('Normal pickup'), 5).events;
  assert.equal(first(pair, 0), first(pair, 1), 'save->stock and save->cash start together');
  const passed = timeline(sc, story('Normal pickup'), 4).events;
  assert.ok(one(passed, 'answer', 1).start - one(passed, 'question', 0).start >= 250, 'the answer shows after the question');
  const refused = timeline(sc, story('Expired certification'), 2).events;
  const answer = one(refused, 'answer', 1);
  const reply = one(refused, 'reply', 1);
  assert.ok(answer.start - one(refused, 'question', 0).start >= 250, 'the refusal shows after the question');
  assert.equal(one(refused, 'fail', 1).start, answer.start, 'the gate turns red with the answer');
  assert.ok(reply.start - answer.end >= 380, 'the red reply waits after the answer');
  const next = scene({
    ...oil.props,
    edges: [...oil.props.edges, { from: 'refused', to: 'sign' }],
    steps: [{ label: 'Retry', flow: [{ edges: ['sync->cert', 'cert->refused', 'refused->sign'] }] }],
  });
  const after = timeline(next, 0, 0).events;
  assert.ok(first(after, 2) >= one(after, 'reply', 1).end, 'a hop after a failed hop waits for the reply');
  for (const evs of [chain, pair, passed, refused]) {
    const cam = evs.find((e) => e.kind === 'camera')!;
    assert.ok(
      evs.every((e) => e === cam || e.start >= cam.end),
      'the camera ends before the first hop',
    );
  }
});

test('the arm of a raised gate lowers over time, and no two units share a bed slot', () => {
  const sc = scene(oil.props);
  const story = (name: string) => sc.stories.findIndex((s) => s.name === name);
  const s = story('Normal pickup');
  const lower = timeline(sc, s, 5).events.find((e) => e.kind === 'arm' && e.hop === 1)!;
  assert.equal(lower.end - lower.start, 260);
  const deg = stateAt(sc, s, 5, (lower.start + lower.end) / 2).gates[1].deg;
  assert.ok(deg > 0 && deg < 78, `the arm is half down: ${deg}`);
  const bed = Object.values(stateAt(sc, story('Paid in cash'), 1, Infinity).units).filter((u) => u.where === 'bed');
  assert.ok(bed.length >= 4);
  assert.equal(new Set(bed.map((u) => u.p.join())).size, bed.length);
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

const near = (r: Rect, p: Pt): Pt => [Math.max(r.x, Math.min(p[0], r.x + r.w)), Math.max(r.y, Math.min(p[1], r.y + r.h))];

function audit(p: Placed, st: Stage): string[] {
  const out: string[] = [];
  const vis = [
    ...p.tags.map((t) => ({ n: `tag ${t.name}`, r: t.r })),
    ...p.signs.map((s) => ({ n: `sign ${s.actor}`, r: s.r })),
    ...p.chips.map((c) => ({ n: `chip ${c.text}`, r: c.r })),
    ...p.devices.map((d) => ({ n: `device ${d.actor}`, r: d.r })),
  ];
  for (let i = 0; i < vis.length; i++)
    for (let j = i + 1; j < vis.length; j++) if (hit(vis[i].r, vis[j].r)) out.push(`${vis[i].n} x ${vis[j].n}`);
  for (const v of vis) {
    for (const g of p.gates) if (hit(v.r, g.r)) out.push(`${v.n} x gate ${g.actor}`);
    p.hulls.forEach((h, a) => polyHit(h, v.r) && out.push(`${v.n} x building ${a}`));
    if (p.truck && polyHit(p.truck, v.r)) out.push(`${v.n} x truck`);
    const { l, t, r, b } = st.region;
    if (v.r.x < l || v.r.y < t || v.r.x + v.r.w > r || v.r.y + v.r.h > b) out.push(`${v.n} outside the view`);
    if (!v.n.startsWith('chip'))
      for (const arc of p.arcs)
        if (arc.some(([x, y]) => x > v.r.x && x < v.r.x + v.r.w && y > v.r.y && y < v.r.y + v.r.h)) out.push(`arc x ${v.n}`);
  }
  for (const o of [...p.tags.filter((t) => !t.pin), ...p.signs]) {
    const [x, y] = near(o.r, o.anchor);
    const len = Math.hypot(x - o.anchor[0], y - o.anchor[1]);
    if (len > 24.5) out.push(`leader ${Math.round(len)} px`);
  }
  return out;
}

test('no tag, sign, chip or device overlaps another overlay or a building', () => {
  const hits: string[] = [];
  for (const fig of [oil, returns]) {
    const sc = scene(fig.props);
    for (const [w, h] of [
      [1440, 900],
      [2000, 1150],
      [390, 844],
    ]) {
      const st = stageFor(w, w >= HUD.wide ? Math.min(h, (w * 10) / 16) : Math.min(h, HUD.tall));
      sc.stories.forEach((story, s) =>
        story.moments.forEach((_, m) => {
          for (const x of audit(place(sc, stateAt(sc, s, m, Infinity), st), st))
            hits.push(`${fig.title} ${w}x${h} ${story.name} ${m + 1}: ${x}`);
        }),
      );
    }
  }
  assert.deepEqual(hits, []);
});

test('a story inside one actor still gets a framed camera', () => {
  const sc = scene({
    layout: {
      children: [
        {
          label: 'Home',
          look: 'person',
          children: [
            { id: 'a', label: 'Wake' },
            { id: 'b', label: 'Eat' },
          ],
        },
      ],
    },
    edges: [{ from: 'a', to: 'b' }],
    steps: [{ label: 'Morning', flow: ['a->b'] }],
  });
  for (const [w, h] of [
    [1440, 900],
    [390, 760],
  ]) {
    const { cam } = place(sc, stateAt(sc, 0, 0, Infinity), stageFor(w, h));
    assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y) && cam.z > 0 && cam.z <= 1, JSON.stringify(cam));
  }
});
