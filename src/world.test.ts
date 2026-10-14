import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LOOKS, edgeId, nodes, str } from './model.ts';
import type { FlowProps } from './model.ts';
import { cast, worldReady } from './explain.ts';
import { HUD } from './looks.ts';
import { CAM, hit, place, polyHit, scene, stageFor, stateAt, storyCams, storyView, timeline } from './world.ts';
import type { Ev, Form, Placed, Pt, Rect, Scene, Stage, State, Tag } from './world.ts';
import oil from '../figures/explain-oil.ts';
import returns from '../figures/returns-process.ts';
import checkout from '../figures/checkout.ts';
import sync from '../figures/explain-sync.ts';
import deliveryBefore from '../figures/explain-delivery-before.ts';
import deliveryAfter from '../figures/explain-delivery-after.ts';

const FIGURES = [oil, returns, checkout, sync, deliveryBefore, deliveryAfter];
const FIXTURES: { title: string; props: FlowProps }[] = await Promise.all(
  readdirSync(new URL('../figures/', import.meta.url))
    .filter((f) => f.endsWith('.ts'))
    .map(async (f) => (await import(`../figures/${f}`)).default),
);

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
  const mark = 'fill="#ffffff" stroke="#3B4252"';
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
  const kick = one(refused, 'fail', 1);
  const arm = (t: number) => Object.values(stateAt(sc, story('Expired certification'), 2, t).gates).find((g) => g.fail)?.deg ?? -1;
  assert.ok(arm(kick.end) > 6, `the refused arm kicks up: ${arm(kick.end)}`);
  assert.equal(arm(reply.start), 0, 'the refused arm is down again before the reply');
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
const inside = (p: Pt, poly: Pt[]) => {
  let o = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
};

const gap = (p: Pt, poly: Pt[]) =>
  inside(p, poly)
    ? 0
    : Math.min(
        ...poly.map((a, i) => {
          const b = poly[(i + 1) % poly.length],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(a[0] + u * dx - p[0], a[1] + u * dy - p[1]);
        }),
      );

function audit(sc: Scene, s: State, p: Placed, st: Stage): string[] {
  const out: string[] = [];
  const { l, t, r, b } = st.region;
  const onStage = (o: Rect) => o.x >= l && o.y >= t && o.x + o.w <= r && o.y + o.h <= b;
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
    if (!onStage(v.r)) out.push(`${v.n} outside the view`);
    if (!v.n.startsWith('chip'))
      for (const arc of p.arcs)
        if (arc.some(([x, y]) => x > v.r.x && x < v.r.x + v.r.w && y > v.r.y && y < v.r.y + v.r.h)) out.push(`arc x ${v.n}`);
  }
  if (!st.narrow && p.arcs.some((arc) => arc.some(([, y]) => y < t + 12))) out.push('arc under the story bar');
  const ends = s.arcs.filter((a) => a.t > 0).map((a) => a.near);
  p.arcs.forEach((arc, k) =>
    p.hulls.forEach((h, a) => !ends[k].includes(a) && arc.some((q) => inside(q, h)) && out.push(`arc x building ${a}`)),
  );
  if (sc.bends.length) {
    const cx = (l + r) / 2,
      cy = (t + b) / 2,
      { x: X, y: Y, z } = p.cam;
    for (const a of s.arcs.filter((a) => a.t > 0)) {
      const pts = Array.from({ length: 241 }, (_, i): Pt => {
        const u = (a.t * i) / 240,
          v = 1 - u,
          k = (j: 0 | 1) => v * v * v * a.a[j] + 3 * v * v * u * a.c1[j] + 3 * v * u * u * a.c2[j] + u * u * u * a.b[j];
        return [(k(0) - X) * z + cx, (k(1) - Y) * z + cy];
      });
      for (const o of p.tags)
        if (pts.some(([x, y]) => x > o.r.x && x < o.r.x + o.r.w && y > o.r.y && y < o.r.y + o.r.h)) out.push(`tag ${o.name} covers an arc`);
    }
  }
  const reach = st.w < HUD.wide && s.summary ? 40.5 : st.narrow ? 64.5 : 24.5;
  for (const o of p.tags) {
    const [x, y] = o.anchor;
    if (o.pin && x >= l && x <= r && y >= t && y <= b) out.push(`tag ${o.name} pinned while its actor is in frame`);
    const [nx, ny] = near(o.r, o.anchor);
    const len = Math.hypot(nx - x, ny - y);
    if (!o.pin && len > reach) out.push(`tag ${o.name} leader ${Math.round(len)} px`);
  }
  for (const o of p.signs) {
    const tag = p.tags.find((x) => x.actor === o.actor)?.r,
      gap = tag ? Math.max(tag.x - o.r.x - o.r.w, o.r.x - tag.x - tag.w, tag.y - o.r.y - o.r.h, o.r.y - tag.y - tag.h, 0) : Infinity;
    if (o.kick && gap <= 120) out.push(`sign ${o.actor} names its owner beside the owner tag`);
    const [x, y] = near(o.r, o.anchor);
    const len = Math.hypot(x - o.anchor[0], y - o.anchor[1]);
    if (len > 24.5) out.push(`sign ${o.actor} leader ${Math.round(len)} px`);
  }
  const shown = (what: string, r?: Rect) => (!r ? out.push(`no ${what}`) : !onStage(r) && out.push(`${what} off stage`));
  sc.actors.forEach((a, i) => {
    const g = s.gates[i];
    if (a.checks && g.rows.length && (g.on === s.moment || (s.summary && g.fail && !st.narrow)))
      shown(`sign ${i}`, p.signs.find((x) => x.actor === i)?.r);
    if (s.summary && g.fail) shown(`failed gate ${i}`, p.gates.find((x) => x.actor === i)?.r);
  });
  if (s.summary) {
    shown('outcome tag', p.tags.find((x) => x.end)?.r);
    for (const u of Object.values(s.units)) {
      const row = (t: Tag) => t.actor === sc.truck && t.cargo.some((c) => c.thing === u.thing && c.fail === u.fail);
      if (u.moment < 0) continue;
      if (!st.narrow && u.where === 'bed') shown(`cargo row ${u.thing}`, p.tags.find(row)?.r);
      else shown(`end chip ${u.thing}`, p.chips.find((x) => x.text === u.thing && x.mark === (u.fail ? '✗' : '✓'))?.r);
    }
  }
  const lorry = p.tags.find((x) => x.actor === sc.truck);
  if (!st.narrow && p.truck && lorry && gap(lorry.anchor, p.truck) > 24) out.push('truck tag off the truck');
  for (const a of s.hi) shown(`tag ${sc.actors[a].name}`, p.tags.find((x) => x.actor === a)?.r);
  for (const a of s.dev) if (!(a === sc.truck && p.truck)) shown(`device ${a}`, p.devices.find((x) => x.actor === a)?.r);
  for (const a of s.arcs) {
    if (a.moment !== s.moment || a.t !== 1 || !a.text) continue;
    const tag = p.tags.find((x) => x.actor === a.to && x.status === a.text),
      chip = p.chips.find((x) => x.text === a.text);
    if (tag && chip) out.push(`chip ${a.text} repeats the tag`);
    shown(tag ? `tag ${a.text}` : `chip ${a.text}`, (tag ?? chip)?.r);
  }
  for (const o of p.signs)
    s.gates[o.actor].rows.forEach((row, i) => {
      const sign = o.rows[i]?.a === row.a,
        tag = p.tags.some((x) => x.actor === o.actor && x.status === row.a && onStage(x.r));
      if (sign === tag) out.push(`sign ${o.actor} states ${row.a} ${sign ? 'twice' : 'nowhere'}`);
    });
  for (const u of Object.values(s.units))
    if (u.moment === s.moment && (u.where === 'yard' || u.where === 'gate'))
      shown(`chip ${u.thing}`, p.chips.find((x) => x.text === u.thing)?.r);
  return out;
}

const SIZES = [
  [1440, 900],
  [2000, 1150],
  [390, 844],
  [1280, 720],
  [1024, 640],
  [880, 700],
  [740, 431],
  [360, 600],
  [344, 565],
  [390, 600],
  [412, 640],
  [390, 844, 179],
  [390, 600, 179],
  [412, 640, 179],
  [360, 600, 229],
];
const STACKED = ['390x844', '390x600', '412x640'];

test('every needed tag, sign, chip and device is on stage, none overlaps, and the camera never jumps and pulls back at the outcome', () => {
  const hits: string[] = [];
  for (const fig of FIXTURES) {
    const scenes = new Map<Form, Scene>(),
      get = (f: Form) => scenes.get(f) ?? scenes.set(f, scene(fig.props, f)).get(f)!;
    for (const [w, h, sheet] of worldReady(fig.props) ? SIZES : SIZES.slice(0, 3)) {
      const st = stageFor(w, w >= HUD.wide ? Math.min(h, (w * 10) / 16) : Math.min(h, HUD.tall), sheet);
      get(st.form).stories.forEach((story, s) => {
        const { sc, cams } = storyView(get, s, st);
        if (worldReady(fig.props) && STACKED.includes(`${w}x${h}`) && !sc.bends.length)
          hits.push(`${fig.title} ${w}x${h} ${story.name}: the diagonal street replaces the stacked street`);
        const z = cams.map((p) => p.cam.z),
          n = z.length;
        const fit = place(sc, stateAt(sc, s, n - 1, Infinity), st).cam.z,
          xs = story.path.flatMap((a) => sc.actors[a].lot.hull.map((p) => p[0])),
          pull = w >= HUD.wide && (Math.max(...xs) - Math.min(...xs)) * fit < 0.7 * (st.region.r - st.region.l),
          phone = w < HUD.wide,
          aim = phone ? z[n - 2] * 2 : pull ? z[n - 2] * 0.92 : Math.min(fit, z[n - 2] * 1.2),
          move = timeline(sc, s, n - 1).events.find((e) => e.kind === 'camera');
        if (z[n - 1] > aim + 1e-6 && !place(sc, stateAt(sc, s, n - 1, Infinity), st, aim).faults)
          hits.push(`${fig.title} ${w}x${h} ${story.name}: the outcome zooms in`);
        if (!pull && z[n - 1] < (phone ? z[n - 2] : aim) - 1e-6) hits.push(`${fig.title} ${w}x${h} ${story.name}: the outcome pulls back`);
        if (!move || move.end - move.start < CAM) hits.push(`${fig.title} ${w}x${h} ${story.name}: the outcome camera cuts short`);
        for (let m = 0; m < n - 2; m++)
          if (z[m] > z[m + 1] * 1.2 + 1e-6) hits.push(`${fig.title} ${w}x${h} ${story.name} ${m + 1}: the zoom jumps out`);
        story.moments.forEach((_, m) => {
          const state = stateAt(sc, s, m, Infinity);
          const p = cams[m];
          if (p.faults) hits.push(`${fig.title} ${w}x${h} ${story.name} ${m + 1}: place() reports ${p.faults} faults`);
          for (const x of audit(sc, state, p, st)) hits.push(`${fig.title} ${w}x${h} ${story.name} ${m + 1}: ${x}`);
        });
      });
    }
  }
  assert.deepEqual(hits, []);
});

test('on a phone, the stacked street shows every building of the "Expired certification" outcome at least 90 px wide', () => {
  const st = stageFor(390, Math.min(844, HUD.tall)),
    s = scene(oil.props).stories.findIndex((x) => x.name === 'Expired certification'),
    { sc, cams } = storyView((f) => scene(oil.props, f), s, st),
    p = cams.at(-1)!,
    { l, t, r, b } = st.region;
  assert.ok(sc.bends.length > 0);
  for (const a of sc.stories[s].path) {
    const h = p.hulls[a],
      w = Math.max(...h.map((q) => q[0])) - Math.min(...h.map((q) => q[0]));
    assert.ok(
      h.some(([x, y]) => x >= l && x <= r && y >= t && y <= b),
      `${sc.actors[a].name} is out of frame`,
    );
    assert.ok(w >= 90, `${sc.actors[a].name}: ${Math.round(w)} px`);
  }
});

test('a stage too small for the overlays gives a frame with faults, not an error', () => {
  const sc = scene(oil.props);
  const faults = sc.stories.flatMap((story, s) =>
    story.moments.map((_, m) => place(sc, stateAt(sc, s, m, Infinity), stageFor(374, 250)).faults),
  );
  assert.ok(faults.every((n) => n > 0));
});

test('a check at the rest of a moment always has an answer', () => {
  const empty: string[] = [];
  for (const { title, props } of FIGURES) {
    const sc = scene(props);
    sc.stories.forEach((story, s) =>
      story.moments.forEach((_, m) => {
        const st = stateAt(sc, s, m, Infinity);
        for (const g of Object.values(st.gates))
          if (g.on === m) for (const row of g.rows) if (!row.a) empty.push(`${title} ${story.name} ${m + 1}: ${row.q}`);
      }),
    );
  }
  assert.deepEqual(empty, []);
});

test('an unlabeled edge out of a check answers with a check mark or a cross', () => {
  const sc = scene({
    layout: {
      children: [
        { label: 'Shop', look: 'shop', children: [{ id: 'a', label: 'Sell' }] },
        {
          label: 'Bank',
          children: [
            { id: 'q', label: 'Paid?', shape: 'decision' },
            { id: 'ok', label: 'Book' },
            { id: 'no', label: 'Refuse', tone: 'red' },
          ],
        },
      ],
    },
    edges: [
      { from: 'a', to: 'q' },
      { from: 'q', to: 'ok' },
      { from: 'q', to: 'no' },
    ],
    steps: [
      { label: 'Pass', flow: ['a->q', 'q->ok'] },
      { label: 'Fail', flow: ['a->q', 'q->no'] },
    ],
  });
  const bank = sc.actors.findIndex((a) => a.name === 'Bank');
  const answer = (story: number) => stateAt(sc, story, 1, Infinity).gates[bank].rows.map((r) => r.a);
  assert.deepEqual(answer(0), ['✓']);
  assert.deepEqual(answer(1), ['✗']);
  assert.equal(stateAt(sc, 1, 1, Infinity).ever[bank].label, 'Refuse', 'a failed check tag shows the result in its own actor');
  const oils = scene(oil.props),
    who = (name: string) => oils.actors.findIndex((a) => a.name === name),
    refused = stateAt(
      oils,
      oils.stories.findIndex((s) => s.name === 'Expired certification'),
      2,
      Infinity,
    ).ever;
  assert.deepEqual(
    [refused[who('Server')].label, refused[who('Worker')].label],
    ['Expired', 'Record refused'],
    'a failed check tag shows the answer when another actor holds the result',
  );
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
    assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y) && cam.z > 0 && cam.z <= 1.2, JSON.stringify(cam));
  }
});

test('an unknown look draws a plain building and still gives a world', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { label: 'Shop', look: 'shop', children: [{ id: 'a', label: 'Sell' }] },
        { label: 'Fort', look: 'castle' as 'shop', children: [{ id: 'b', label: 'Guard' }] },
      ],
    },
    edges: [{ from: 'a', to: 'b' }],
    steps: [{ label: 'Visit', flow: ['a->b'] }],
  };
  const sc = scene(fig);
  assert.equal(sc.actors[1].lot.hull.length > 2, true);
  assert.equal(storyCams(sc, 0, stageFor(1440, 900)).length, 2);
});

test('more units than the truck bed holds stay in the yard, with finite positions and a framed camera', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { label: 'Shop', look: 'shop', children: ['x', 'y', 'z'].map((id) => ({ id, label: id.toUpperCase() })) },
        { label: 'Van', look: 'truck', children: [{ id: 't', label: 'Load' }] },
        { label: 'Home', look: 'person', children: [{ id: 'h', label: 'Receive' }] },
      ],
    },
    edges: [
      ...['x', 'y', 'z'].map((id) => ({ from: id, to: 't', carries: { thing: `thing ${id}`, count: 4 } })),
      { from: 't', to: 'h', carries: { thing: 'thing x', count: 4 } },
    ],
    steps: [{ label: 'Deliver', flow: ['x->t', 'y->t', 'z->t', 't->h'] }],
  };
  const sc = scene(fig);
  sc.stories[0].moments.forEach((_, m) => {
    for (const u of Object.values(stateAt(sc, 0, m, Infinity).units)) assert.ok(u.p.every(Number.isFinite), `${u.thing} ${u.k} at ${m}`);
  });
  for (const [w, h] of [
    [1440, 900],
    [390, 760],
  ])
    for (const p of storyCams(sc, 0, stageFor(w, h))) assert.ok(Number.isFinite(p.cam.z) && p.faults >= 0);
});

test('an unlabeled refusal into another actor names the check on the failed tag', () => {
  const sc = scene({
    layout: {
      children: [
        {
          label: 'Shop',
          look: 'shop',
          children: [
            { id: 'a', label: 'Sell' },
            { id: 'no', label: 'Refuse', tone: 'red' },
          ],
        },
        { label: 'Bank', children: [{ id: 'q', label: 'Paid?', shape: 'decision' }] },
      ],
    },
    edges: [
      { from: 'a', to: 'q' },
      { from: 'q', to: 'no' },
    ],
    steps: [{ label: 'Fail', flow: ['a->q', 'q->no'] }],
  });
  const bank = sc.actors.findIndex((a) => a.name === 'Bank');
  assert.equal(stateAt(sc, 0, 1, Infinity).ever[bank].label, 'Paid?');
});
