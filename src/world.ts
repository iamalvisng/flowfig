import { cast, failed, hopsOf, isCheck, moments, question } from './explain.ts';
import { edgeId, isGroup, nodes, str } from './model.ts';
import type { FigLook, FlowProps } from './model.ts';
import { HUD } from './looks.ts';
import { textWidth } from './text.ts';
import { BAR_Y, BED_ROWS, C, GL, GZ, INK, LANE, P, PHONE, S, TD, UNIT, gateArt, hull, street, truckArt } from './world-art.ts';
import type { Gate, Lot, Pt } from './world-art.ts';

export type { Pt };

export type Carry = { thing: string; form: 'box' | 'barrel' | 'notes'; count: number; from: number };
export type Hop = { edge: string; from: string; to: string; label: string; data: string; async: boolean; fail: boolean; carry?: Carry };
export type Box = { label: string; actor: number; dead: boolean; check: string; done?: string };
export type Device = 'phone' | 'cab' | 'antenna';
export type SceneActor = { name: string; look?: FigLook; device: Device; lot: Lot; gate: Gate; port: Pt; checks: boolean };
export type Story = { name: string; moments: Hop[][]; acting: string[]; path: number[]; end: string };
export type Form = 'narrow' | 'wide' | 'stack' | 'spread';
export type Scene = {
  svg: string;
  bends: Pt[];
  actors: SceneActor[];
  boxes: Record<string, Box>;
  stories: Story[];
  truck: number;
  truckArt: ReturnType<typeof truckArt> | null;
  things: Map<string, { form: Carry['form']; count: number }>;
  keys: ('data' | 'thing' | 'check')[];
  clear: number;
};

const FORMS: readonly Carry['form'][] = ['box', 'barrel', 'notes'];
const BED = BED_ROWS.length * 4;
const units = (n?: number) => Math.min(4, Math.max(1, Math.round(n ?? 1)));

export function scene(fig: FlowProps, form: Form = 'narrow'): Scene {
  const cs = cast(fig);
  const all = nodes(fig.layout);
  const byId = new Map(all.map((n) => [n.id, n]));
  const actorOf = new Map(cs.flatMap((a, i) => a.boxes.map((id) => [id, i] as const)));
  const firstBox = new Map<string, string>();
  const walk = (g: FlowProps['layout']) => {
    for (const c of g.children) {
      if (!isGroup(c)) continue;
      const first = nodes(c)[0];
      if (c.id && first) firstBox.set(c.id, first.id);
      walk(c);
    }
  };
  walk(fig.layout);

  const truck = cs.findIndex((a) => a.look === 'truck');
  const devices = cs.map((a, i): Device => (i === truck ? 'cab' : a.look === 'person' || a.look === 'phone' ? 'phone' : 'antenna'));
  const stack = form === 'stack' || form === 'spread',
    {
      svg: ground,
      lots,
      bends,
    } = street(
      cs.map((a) => a.look),
      devices.map((d) => d === 'antenna'),
      form === 'wide' ? 8.5 : 10.5,
      stack ? (form === 'spread' ? 15 : 12) : 0,
    );

  const things: Scene['things'] = new Map();
  for (const e of fig.edges) {
    const c = typeof e.carries === 'object' ? e.carries : undefined;
    if (c && str(c.thing) && !things.has(c.thing))
      things.set(c.thing, { form: FORMS.find((x) => x === c.form) ?? 'box', count: units(c.count) });
  }

  const actors: SceneActor[] = cs.map((a, i) => {
    const device = devices[i];
    const xs = (k: number) => lots[k].hull.map((p) => p[0]);
    const left = Math.min(...xs(i));
    const prev = i > 0 && !stack ? Math.max(...xs(i - 1)) : left - 160,
      dy = lots[i].y;
    const d = (left - Math.min(44, (left - prev) * 0.28)) / C + BAR_Y + dy;
    return {
      name: a.name,
      look: a.look,
      device,
      lot: lots[i],
      gate: { px: d - GL / 2, ex: d + GL / 2, y: BAR_Y + dy, z: GZ, L: GL },
      port: [(left - 28) / C + 4.95 + dy, 4.95 + dy],
      checks: a.boxes.some((id) => isCheck(byId.get(id))),
    };
  });

  const boxes: Scene['boxes'] = {};
  cs.forEach((a, i) =>
    a.boxes.forEach((id) => {
      const n = byId.get(id);
      if (n) boxes[id] = { label: str(n.label), actor: i, dead: n.tone === 'red' || n.tone === 'gray', check: question(n), done: n.done };
    }),
  );

  const stories: Story[] = (fig.steps ?? []).map((step) => {
    const label = str(step.label);
    const beats = hopsOf(fig, step);
    const path = new Set<number>();
    const toHop = (h: (typeof beats)[number]['hops'][number]): Hop => {
      const c = typeof h.edge.carries === 'object' && str(h.edge.carries.thing) ? h.edge.carries : undefined;
      const hop: Hop = {
        edge: edgeId(h.edge),
        from: h.source,
        to: h.target,
        label: str(h.edge.label),
        data: str(h.data),
        async: !!h.async,
        fail: failed(byId, h),
      };
      if (c) {
        const origin = c.from ? (byId.has(c.from) ? c.from : firstBox.get(c.from)) : h.source;
        hop.carry = { thing: c.thing, ...things.get(c.thing)!, from: actorOf.get(origin ?? '') ?? -1 };
      }
      for (const a of [actorOf.get(h.source), actorOf.get(h.target), hop.carry?.from]) if (a !== undefined && a >= 0) path.add(a);
      return hop;
    };
    const hops = beats.map((b) => b.hops.map(toHop));
    return {
      name: label,
      moments: hops.length ? [...hops, []] : [],
      acting: moments(fig, label).map((m) => m.actor),
      path: [...path],
      end: hops.at(-1)?.at(-1)?.to ?? '',
    };
  });

  const hopsAll = stories.flatMap((s) => s.moments.flat());
  const sides = (h: Hop) => [boxes[h.from]?.actor, boxes[h.to]?.actor];
  const keys: Scene['keys'] = [];
  if (hopsAll.some((h) => !h.carry && new Set(sides(h)).size === 2 && sides(h).every((a) => a !== undefined))) keys.push('data');
  if (hopsAll.some((h) => h.carry)) keys.push('thing');
  if (hopsAll.some((h) => isCheck(byId.get(h.from)))) keys.push('check');

  const art = truck >= 0 ? truckArt(lots[truck].depot!) : null;
  return {
    clear: form === 'wide' ? 64 : CLEAR,
    bends,
    svg:
      ground +
      actors
        .filter((a) => a.checks)
        .map((a) => gateArt(a.gate))
        .join('') +
      (art?.yard ?? ''),
    actors,
    boxes,
    stories,
    truck,
    truckArt: art,
    things,
    keys,
  };
}

export type Status = { label: string; fail: boolean; done?: string };
const named = (ev: Status, summary: boolean) => (summary && ev.done) || ev.label;
export type Arc = {
  a: Pt;
  c1: Pt;
  c2: Pt;
  b: Pt;
  t: number;
  text: string;
  fail: boolean;
  hold: boolean;
  gate: number;
  dashed: boolean;
  moment: number;
  near: number[];
  to: number;
};
export type Unit = {
  thing: string;
  k: number;
  p: Pt;
  where: 'yard' | 'bed' | 'air' | 'road' | 'gate' | 'in';
  at: number;
  fail: boolean;
  moment: number;
};
export type Truck = { orient: 'y' | 'L' | 'R' | 'D' | 'U'; x: number; y: number; lot: number; door: number; load: string[] };
export type GateState = { rows: { box: string; q: string; a: string; fail: boolean }[]; deg: number; fail: boolean; on: number };
export type State = {
  story: number;
  moment: number;
  summary: boolean;
  hi: number[];
  ever: Record<number, Status>;
  arcs: Arc[];
  units: Record<string, Unit>;
  truck: Truck | null;
  gates: Record<number, GateState>;
  dev: number[];
  screens: Record<number, 'idle' | 'in' | 'tx'>;
  frame: Pt[];
  lead?: Pt;
  fade?: number;
};
export type Ev = {
  kind: 'camera' | 'pulse' | 'door' | 'drive' | 'unit' | 'parcel' | 'question' | 'answer' | 'arm' | 'release' | 'fail' | 'reply';
  hop: number;
  start: number;
  end: number;
};
type Step = Omit<Ev, 'kind'> & {
  kind: Ev['kind'] | null;
  curve: (p: number) => number;
  apply: (s: State, p: number) => void;
  head?: (s: State, p: number) => Pt | undefined;
};
type Route = { a: Pt; c1: Pt; c2: Pt; b: Pt };

export const CAM = 700;
const CLEAR = 92;

function bezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x,
    bx = 3 * (p2x - p1x) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * p1y,
    by = 3 * (p2y - p1y) - cy,
    ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0,
      hi = 1,
      t = x;
    for (let i = 0; i < 24; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-5) break;
      if (e > 0) hi = t;
      else lo = t;
      const d = dX(t);
      t = Math.abs(d) > 1e-6 ? t - e / d : (lo + hi) / 2;
      if (t <= lo || t >= hi) t = (lo + hi) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}
export const ease = { out: bezier(0.23, 1, 0.32, 1), inOut: bezier(0.77, 0, 0.175, 1) };
const linear = (p: number) => p;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const bez = (r: Route, t: number): Pt => {
  const u = 1 - t,
    k = (i: 0 | 1) => u * u * u * r.a[i] + 3 * u * u * t * r.c1[i] + 3 * u * t * t * r.c2[i] + t * t * t * r.b[i];
  return [k(0), k(1)];
};
const upright = (t: Truck) => 'yDU'.includes(t.orient);
const mean = (ps: Pt[]): Pt | undefined =>
  ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : undefined;
const segLen = (p: Pt[]) => p.slice(1).reduce((l, q, i) => l + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
const along = (p: Pt[], d: number): Pt => {
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (d <= l || i === p.length - 1) return lerp(p[i - 1], p[i], l ? Math.min(1, d / l) : 1);
    d -= l;
  }
  return p[p.length - 1];
};
const yardSpot = (sc: Scene, a: number, k: number): Pt => [
  sc.actors[a].lot.x + 2.2 + (k % 2) * 0.42,
  4.84 + Math.floor(k / 2) * 0.38 + sc.actors[a].lot.y,
];

function inPoly(p: Pt, poly: Pt[]) {
  let o = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
}
function topAt(poly: Pt[], x: number) {
  let y = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i],
      [x1, y1] = poly[(i + 1) % poly.length];
    if ((x - x0) * (x - x1) <= 0 && x0 !== x1) y = Math.min(y, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return y;
}
const coarse = (n: number) => Array.from({ length: n + 1 }, (_, i) => i).sort((x, y) => (x % 8 ? 1 : 0) - (y % 8 ? 1 : 0));
const SPOTS = coarse(160);
function clears(r: Route, hulls: Pt[][], near: number[], cl = CLEAR) {
  for (const n of SPOTS) {
    const p = bez(r, n / 160);
    if (Math.hypot(p[0] - r.a[0], p[1] - r.a[1]) < 10 || Math.hypot(p[0] - r.b[0], p[1] - r.b[1]) < 10) continue;
    for (let i = 0; i < hulls.length; i++) {
      if (near.includes(i)) continue;
      const y = topAt(hulls[i], p[0]);
      if (inPoly(p, hulls[i]) || (p[1] < y && y - p[1] < cl)) return false;
    }
  }
  return true;
}
function route(a: Pt, b: Pt, hulls: Pt[][], near: number[], cl = CLEAR): Route {
  for (let top = Math.min(a[1], b[1]) - 80; ; top -= 20) {
    const r: Route = { a, b, c1: [a[0], top], c2: [b[0], top] };
    if (top < -1200 || clears(r, hulls, near, cl)) return r;
  }
}

const TALL: number[][] = [];
for (let r1 = 80; r1 <= 480; r1 += 80)
  for (let r2 = 80; r2 <= 480; r2 += 80)
    for (let d1 = -240; d1 <= 240; d1 += 120) for (let d2 = -240; d2 <= 240; d2 += 120) TALL.push([r1, r2, d1, d2]);
const edgeGap = (p: Pt, poly: Pt[]) =>
  Math.min(
    ...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
    }),
  );
const COARSE = coarse(96);
const tallOrder = new Map<string, number[][]>();
function tall(a: Pt, b: Pt, hulls: Pt[][], near: number[], over: number, side: number, mid: number): Route | undefined {
  const sa = Math.sign(mid - a[0]),
    sb = Math.sign(mid - b[0]),
    key = `${sa}${sb}`;
  let order = tallOrder.get(key);
  if (!order) {
    const cost = ([r1, r2, p, q]: number[]) => r1 + r2 + (Math.abs(p) + Math.abs(q)) / 4 + (p * sa < 0 ? 200 : 0) + (q * sb < 0 ? 200 : 0);
    tallOrder.set(key, (order = TALL.map((c) => [...c, cost(c)]).sort((x, y) => x[4] - y[4])));
  }
  const box = hulls.map(bounds),
    lift = Math.min(a[1], b[1]) - 60;
  next: for (const [r1, r2, p, q] of order) {
    const r: Route = { a, b, c1: [a[0] + p, a[1] - r1], c2: [b[0] + q, b[1] - r2] },
      ps = COARSE.map((n) => bez(r, n / 96));
    if (!ps.some((c) => c[1] <= lift)) continue;
    for (const c of ps) {
      if (Math.min(Math.hypot(c[0] - a[0], c[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])) < 16) continue;
      for (let i = 0; i < hulls.length; i++) {
        const h = hulls[i],
          o = box[i];
        if (near.includes(i) || c[0] < o.x - side || c[0] > o.x + o.w + side || c[1] > o.y + o.h + side || c[1] < o.y - over) continue;
        const y = topAt(h, c[0]);
        if (inPoly(c, h) || (c[1] < y ? y - c[1] < over : edgeGap(c, h) < side)) continue next;
      }
    }
    return r;
  }
}

function fresh(sc: Scene, story: number): State {
  const s: State = {
    story,
    moment: -1,
    summary: false,
    hi: [],
    ever: {},
    arcs: [],
    units: {},
    truck: null,
    gates: {},
    dev: [],
    screens: {},
    frame: [],
  };
  const depot = sc.truck >= 0 ? sc.actors[sc.truck].lot.depot : null;
  if (depot) s.truck = { orient: 'y', x: depot.x + 0.66, y: depot.y - 1.62, lot: sc.truck, door: 1, load: [] };
  sc.actors.forEach((_, a) => (s.gates[a] = { rows: [], deg: 0, fail: false, on: -1 }));
  const seen = new Set<string>();
  for (const h of sc.stories[story].moments.flat()) {
    const c = h.carry;
    const a = c && c.from >= 0 ? c.from : sc.boxes[h.from]?.actor;
    if (!c || seen.has(c.thing) || a === undefined) continue;
    seen.add(c.thing);
    for (let k = 0; k < c.count; k++) {
      const id = `${c.thing}/${k}`,
        bed = a === sc.truck && c.form !== 'notes' && s.truck && s.truck.load.length < BED ? s.truck : null;
      s.units[id] = {
        thing: c.thing,
        k,
        p: bed ? [0, 0] : P(...yardSpot(sc, a, k)),
        where: bed ? 'bed' : 'yard',
        at: a,
        fail: false,
        moment: -1,
      };
      if (bed) bed.load.push(id);
    }
  }
  return s;
}

function kit(sc: Scene, s: State) {
  const A = sc.actors,
    T = sc.truck,
    depot = T >= 0 ? A[T].lot.depot! : { x: 0, y: 0 },
    YX = depot.x + 0.66;
  const parked = () => !s.truck || (s.truck.orient === 'y' && s.truck.y + 2.5 <= depot.y + 0.9);
  const inCab = (a: number) => a === T && !parked();
  const cabBase = (t: Truck) =>
    upright(t)
      ? P(t.x + TD + 0.03, t.y + (t.orient === 'U' ? 0.33 : 2.17), 0.58)
      : P(t.orient === 'R' ? t.x + 2.18 : t.x + 0.31, t.y + TD / 2 + 0.41, 0.58);
  const devBase = (a: number) => (inCab(a) ? cabBase(s.truck!) : P(...A[a].port));
  return {
    YX,
    parked,
    inCab,
    devBase,
    devTop: (a: number): Pt => {
      const b = devBase(a);
      return [b[0], b[1] - PHONE.h * (inCab(a) ? 0.82 : 1) - 4];
    },
    gateMid: (a: number) => {
      const g = A[a].gate;
      return P((g.px + g.ex) / 2, g.y, g.z);
    },
    gateEnds: (a: number) => {
      const g = A[a].gate;
      return [P(g.ex, g.y, g.z - 0.05), P(g.ex, g.y)];
    },
    truckPts: (t: Truck, g = 1): Pt[] => {
      const c = t.y + TD / 2,
        w = upright(t)
          ? [t.x, t.x + TD].flatMap((x) => [P(x, t.y), P(x, t.y + 2.5), P(x, t.y, t.orient === 'y' ? 0.9 : 1.13), P(x, t.y + 2.5, 1.13)])
          : [t.x, t.x + 2.5].flatMap((x) => [c - 0.4, c + 0.4].flatMap((y) => [P(x, y), P(x, y, 1.13)]));
      if (s.dev.includes(T)) {
        const b = cabBase(t);
        w.push([b[0] - 11 * g, b[1] - 40 * g], [b[0] + 11 * g, b[1] - 40 * g]);
      }
      return w;
    },
  };
}

const answer = (h: Hop) => h.label.charAt(0).toUpperCase() + h.label.slice(1) || (h.fail ? '✗' : '✓');

const plans = new WeakMap<Scene, Map<string, ReturnType<typeof planOf>>>();
function plan(sc: Scene, story: number, m: number) {
  const memo = plans.get(sc) ?? new Map<string, ReturnType<typeof planOf>>();
  plans.set(sc, memo);
  const key = `${story}/${m}`;
  if (!memo.has(key)) memo.set(key, planOf(sc, story, m));
  return memo.get(key)!;
}

function planOf(sc: Scene, story: number, m: number) {
  const st = sc.stories[story],
    hops = st.moments[m] ?? [],
    A = sc.actors,
    T = sc.truck;
  const start = stateAt(sc, story, m - 1, Infinity);
  start.moment = m;
  start.summary = !hops.length && m === st.moments.length - 1;
  start.arcs = start.arcs.filter((a) => a.hold || start.summary);
  start.frame = start.arcs.filter((a) => !start.summary || a.fail).map((a) => a.b);
  start.hi = [];
  start.dev = [];
  const s = structuredClone(start),
    steps: Step[] = [];
  const add = (kind: Step['kind'], hop: number, at: number, ms: number, apply: Step['apply'], curve = ease.inOut, head?: Step['head']) => {
    steps.push({ kind, hop, start: at, end: at + ms, curve, apply, head });
    apply(s, 1);
    return at + ms;
  };
  const set = (hop: number, at: number, apply: (s: State) => void) => add(null, hop, at, 0, apply);

  const { YX, gateMid, gateEnds, devBase, devTop, truckPts } = kit(sc, s),
    hulls = A.map((a) => a.lot.hull),
    mid = mean(hulls.flat())![0];
  const bedAt = (t: Truck, i: number) =>
    P(t.x + sc.truckArt!.slots[t.orient === 'R' ? 'R' : 'L'][i % 4], BED_ROWS[Math.floor(i / 4)] + t.y + TD / 2 - LANE, 0.43);
  const truckRef = (t: Truck) => (t.orient === 'y' ? t.x : t.orient === 'R' ? t.x + 2.18 : t.x + 0.31);
  const front = (t: Truck) =>
    upright(t) ? P(t.x + TD / 2, t.y + (t.orient === 'U' ? 0 : 2.5), 0.6) : P(t.orient === 'R' ? t.x + 2.5 : t.x, t.y + TD / 2, 0.6);
  const road = (a: number, b: number, o: number): Pt[] => {
    const B = sc.bends,
      out: Pt[] = [];
    for (let k = a; B.length && a !== b; k += b > a ? 1 : -1) {
      out.push([B[k][0] - o, B[k][1] - o]);
      if (k === b) break;
    }
    return out;
  };
  const hl = (...as: number[]) =>
    as.forEach((a) => {
      if (!s.hi.includes(a)) s.hi.push(a);
      s.frame.push(...A[a].lot.hull);
    });
  const idsOf = (thing: string) => Object.keys(s.units).filter((id) => s.units[id].thing === thing);
  const moving = (ids: string[]) => (st: State) =>
    mean(ids.filter((id) => ['air', 'road'].includes(st.units[id].where)).map((id) => st.units[id].p));
  const hopUnit = (i: number, at: number, id: string, ids: string[], from: Pt, to: Pt, where: Unit['where'], ta: number) =>
    add(
      'unit',
      i,
      at,
      460,
      (st, p) => {
        const u = st.units[id],
          t = st.truck!,
          q = lerp(from, to, p);
        u.p = [q[0], q[1] - 46 * 4 * p * (1 - p)];
        u.where = p < 1 ? 'air' : where;
        u.at = ta;
        t.load = t.load.filter((x) => x !== id);
        if (where === 'bed' && p === 1) t.load.push(id);
      },
      ease.inOut,
      moving(ids),
    );

  const endpoint = (i: number, at: number, a: number, box: string, near: number[]): Pt => {
    if (sc.boxes[box].check) {
      s.frame.push(...gateEnds(a));
      return gateMid(a);
    }
    if (A[a].device === 'antenna') {
      near.push(a);
      return A[a].lot.roof!;
    }
    set(i, at, (st) => {
      if (!st.dev.includes(a)) st.dev.push(a);
      st.screens[a] ??= 'idle';
    });
    s.frame.push(devBase(a), devTop(a));
    return devTop(a);
  };
  const pulse = (
    kind: 'pulse' | 'reply',
    i: number,
    at: number,
    a: Pt,
    b: Pt,
    extra: Pick<Arc, 'gate' | 'hold' | 'fail' | 'text' | 'dashed' | 'to'>,
    near: number[],
  ) => {
    const r = sc.bends.length
        ? (tall(a, b, hulls, near, CLEAR, 14, mid) ?? tall(a, b, hulls, near, 0, 0, mid) ?? route(a, b, hulls, near))
        : route(a, b, hulls, near, sc.clear),
      ps = Array.from({ length: 9 }, (_, k) => bez(r, k / 8));
    s.frame.push(...ps);
    return add(
      kind,
      i,
      at,
      Math.min(1500, 450 + 0.7 * segLen(ps)),
      (st, t) => void st.arcs.push({ ...r, ...extra, t, moment: m, near }),
      ease.inOut,
      (_, t) => bez(r, t),
    );
  };

  const drive = (i: number, at: number, a: number) => {
    const t = s.truck!,
      head = (st: State) => front(st.truck!),
      lot = A[a].lot,
      plan: Pt[] = [[truckRef(t), LANE + A[t.lot].lot.y], ...road(t.lot, a, 0.4), [lot.door, LANE + lot.y]];
    for (let k = plan.length - 2; k > 0; k--) {
      const [p, q, r] = plan.slice(k - 1, k + 2);
      if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-6) plan.splice(k, 1);
    }
    const orient = plan[1][0] < plan[0][0] ? 'L' : 'R',
      goL = plan.at(-1)![0] < plan.at(-2)![0];
    s.frame.push(...truckPts(t));
    if (t.orient === 'y') {
      const y0 = t.y,
        y1 = A[T].lot.depot!.y + 0.53;
      if (t.door < 1) at = add('door', i, at, 500, (st, p) => void (st.truck!.door = p), ease.inOut, head);
      at = add(
        'drive',
        i,
        at,
        1000,
        (st, p) => {
          const tr = st.truck!;
          tr.y = y0 + (y1 - y0) * p;
          if (p === 1) Object.assign(tr, { orient, x: orient === 'R' ? YX - 1.78 : YX, y: LANE - TD / 2 + A[T].lot.y });
        },
        ease.inOut,
        head,
      );
    } else if (t.orient !== orient) {
      const x = t.x + (orient === 'R' ? -1.78 : 1.78);
      set(i, at, (st) => Object.assign(st.truck!, { orient, x }));
    }
    const x1 = goL ? lot.x + 0.95 : lot.x + 0.2,
      bends = plan.slice(1, -1),
      way: Pt[] = [[t.x + 1.25, t.y + TD / 2], ...bends, [x1 + 1.25, LANE + lot.y]];
    for (const [x, y] of bends) s.frame.push(...truckPts({ ...t, orient: 'D', x: x - TD / 2, y: y - 1.25 }));
    s.frame.push(...truckPts({ ...t, orient: goL ? 'L' : 'R', x: x1, y: LANE - TD / 2 + lot.y }));
    return add(
      'drive',
      i,
      at,
      Math.min(2200, 900 + segLen(way) * 60),
      (st, p) => {
        const tr = st.truck!,
          d = segLen(way) * p,
          [x, y] = along(way, d);
        let k = 1;
        while (k < way.length - 1 && segLen(way.slice(0, k + 1)) < d) k++;
        const dx = way[k][0] - way[k - 1][0],
          dy = way[k][1] - way[k - 1][1],
          o = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
        Object.assign(tr, o === 'D' || o === 'U' ? { orient: o, x: x - TD / 2, y: y - 1.25 } : { orient: o, x: x - 1.25, y: y - TD / 2 });
        if (p === 1) tr.lot = a;
      },
      ease.inOut,
      head,
    );
  };
  const driveTo = (i: number, at: number, a: number) => {
    const t = s.truck!;
    if (t.orient !== 'y' && t.lot === a) {
      s.frame.push(...truckPts(t));
      return at;
    }
    return drive(i, at, a);
  };

  const carry = (i: number, at: number, h: Hop, sa: number, ta: number) => {
    const ids = idsOf(h.carry!.thing),
      toGate = !!sc.boxes[h.to].check,
      where = toGate ? 'gate' : 'yard';
    if (!ids.length) return at;
    const dest = (k: number): Pt =>
      toGate ? [(A[ta].gate.px + A[ta].gate.ex) / 2 + 0.1 - k * 0.42, 6.45 + A[ta].lot.y] : yardSpot(sc, ta, k);
    set(i, at, (st) => ids.forEach((id) => (st.units[id].moment = m)));
    if (toGate) set(i, at, (st) => void (st.gates[ta].on = m));
    const truck = h.carry!.form !== 'notes' && s.truck;
    if (truck && ta === T) {
      const t0 = driveTo(i, at, sa),
        base = truck.load.length;
      const fit = ids.slice(0, Math.max(0, BED - base));
      s.frame.push(...fit.map((id) => s.units[id].p));
      return Math.max(t0, ...fit.map((id, k) => hopUnit(i, t0 + 280 * k, id, fit, s.units[id].p, bedAt(s.truck!, base + k), 'bed', ta)));
    }
    if (truck && sa === T) {
      const t0 = driveTo(i, at, ta);
      return Math.max(
        ...ids.map((id, k) => {
          const slot = s.truck!.load.indexOf(id);
          return hopUnit(i, t0 + 280 * k, id, ids, slot < 0 ? s.units[id].p : bedAt(s.truck!, slot), P(...dest(k)), where, ta);
        }),
      );
    }
    const paths = ids.map((id, k): Pt[] => {
      const [x, y] = s.units[id].p,
        ux = (x / C + y / S) / 2,
        uy = (y / S - x / C) / 2,
        [tx, ty] = dest(k);
      return [[ux, uy], [ux, 6.75 + A[s.units[id].at].lot.y], ...road(s.units[id].at, ta, 0.25), [tx, 6.75 + A[ta].lot.y], [tx, ty]];
    });
    paths.forEach((p) => s.frame.push(...p.map((q) => P(...q)), P(...p.at(-1)!, 1.2)));
    return add(
      'parcel',
      i,
      at,
      Math.min(2600, 700 + Math.max(...paths.map(segLen)) * 130),
      (st, e) =>
        ids.forEach((id, k) => {
          const u = st.units[id],
            d = segLen(paths[k]) * e,
            q = P(...along(paths[k], d));
          u.p = [q[0], q[1] - (e < 1 ? Math.abs(Math.sin(d * Math.PI * 1.6)) * 5 : 0)];
          u.where = e < 1 ? 'road' : where;
          u.at = ta;
        }),
      ease.inOut,
      moving(ids),
    );
  };

  const hop = (i: number, at: number) => {
    const h = hops[i],
      fb = sc.boxes[h.from],
      tb = sc.boxes[h.to];
    if (!fb || !tb) return at;
    const fa = fb.actor,
      ta = tb.actor,
      sa = (h.carry && Object.values(s.units).find((u) => u.thing === h.carry!.thing)?.at) ?? fa;
    const reach = (a: number, b: Box) => (st: State) => void (st.ever[a] = { label: b.label, fail: b.dead, done: b.done });
    set(i, at, reach(fa, fb));
    hl(sa, ta);
    if (fb.check) {
      hl(fa);
      s.frame.push(...gateEnds(fa));
      add('answer', i, at, 0, (st) => {
        const g = st.gates[fa],
          row = g.rows.find((r) => r.box === h.from) ?? g.rows[g.rows.push({ box: h.from, q: fb.check, a: '', fail: false }) - 1];
        Object.assign(row, { a: answer(h), fail: h.fail });
        g.on = m;
      });
      if (h.fail) {
        for (const u of Object.values(s.units)) if (u.where === 'gate' && u.at === fa) s.frame.push(u.p);
        add(null, i, at, 160, (st, p) =>
          st.arcs.forEach((x) => {
            if (x.gate === fa && x.hold)
              x.t = p < 1 ? 1 - (8 / segLen(Array.from({ length: 9 }, (_, k) => bez(x, k / 8)))) * Math.sin(Math.PI * p) : 1;
          }),
        );
        at = add(
          'fail',
          i,
          at,
          90,
          (st, p) => {
            st.gates[fa].deg = 12 * p;
            if (p < 1) return;
            st.gates[fa].fail = true;
            st.arcs.forEach((x) => (x.fail ||= x.gate === fa && x.hold));
            for (const u of Object.values(st.units)) u.fail ||= u.where === 'gate' && u.at === fa;
            st.ever[fa] = { label: ta === fa ? tb.label : h.label ? answer(h) : fb.label, fail: true };
          },
          ease.out,
        );
        const kw = (2 * Math.PI) / 0.25,
          kd = kw * Math.sqrt(0.75);
        at = add(
          'arm',
          i,
          at,
          290,
          (st, p) => {
            const T = p * 0.29;
            st.gates[fa].deg =
              p < 1 ? Math.max(0, 12 * Math.exp(-0.5 * kw * T) * (Math.cos(kd * T) + ((0.5 * kw) / kd) * Math.sin(kd * T))) : 0;
          },
          linear,
        );
        if (ta !== fa) {
          const near: number[] = [];
          at = pulse(
            'reply',
            i,
            at,
            gateMid(fa),
            endpoint(i, at, ta, h.to, near),
            { gate: -1, hold: false, fail: true, text: tb.label, dashed: h.async, to: ta },
            near,
          );
        }
        set(i, at, reach(ta, tb));
        return at;
      }
      at += 380;
      const z = 0.8,
        w = (2 * Math.PI) / 0.4,
        wd = w * Math.sqrt(1 - z * z);
      at = add(
        'arm',
        i,
        at,
        460,
        (st, p) => {
          const T = p * 0.46;
          st.gates[fa].deg = p < 1 ? 78 * (1 - Math.exp(-z * w * T) * (Math.cos(wd * T) + ((z * w) / wd) * Math.sin(wd * T))) : 78;
        },
        linear,
      );
      set(i, at, (st) => st.arcs.forEach((x) => (x.hold &&= x.gate !== fa)));
      const us = Object.keys(s.units).filter((id) => s.units[id].where === 'gate' && s.units[id].at === fa);
      if (us.length) {
        const from = us.map((id) => s.units[id].p),
          to = P(A[fa].lot.door, 4.75 + A[fa].lot.y);
        at = add(
          'release',
          i,
          at,
          520,
          (st, p) =>
            us.forEach((id, k) => {
              st.units[id].p = lerp(from[k], to, p);
              st.units[id].where = p < 1 ? 'gate' : 'in';
            }),
          ease.inOut,
          (st) => mean(us.map((id) => st.units[id].p)),
        );
      }
    }
    if (sa !== ta && h.carry) at = carry(i, at, h, sa, ta);
    else if (sa !== ta) {
      const near: number[] = [],
        from = endpoint(i, at, sa, h.from, near),
        to = endpoint(i, at, ta, h.to, near),
        gate = !!tb.check,
        tx = !fb.check && A[sa].device !== 'antenna';
      if (gate) set(i, at, (st) => void (st.gates[ta].on = m));
      if (tx) set(i, at, (st) => void (st.screens[sa] = 'tx'));
      at = pulse(
        'pulse',
        i,
        at,
        from,
        to,
        { gate: gate ? ta : -1, hold: gate, fail: false, text: fb.check ? '' : h.data || h.label, dashed: h.async, to: ta },
        near,
      );
      if (tx) set(i, at, (st) => void (st.screens[sa] = 'idle'));
      if (!gate) set(i, at, (st) => void (st.dev.includes(ta) && (st.screens[ta] = 'in')));
    }
    if (tb.check) {
      const reset = sa !== ta,
        d0 = s.gates[ta].deg;
      s.frame.push(...gateEnds(ta));
      if (d0 > 0) at = add('arm', i, at, 260, (st, p) => void (st.gates[ta].deg = d0 * (1 - p)));
      add('question', i, at, 0, (st) => {
        const g = st.gates[ta];
        if (reset) Object.assign(g, { rows: [], fail: false });
        if (!g.rows.some((r) => r.box === h.to)) g.rows.push({ box: h.to, q: tb.check, a: '', fail: false });
        g.on = m;
      });
      at += 250;
      const out = hops.some((x) => x.from === h.to)
        ? undefined
        : st.moments
            .slice(m + 1)
            .flat()
            .find((x) => x.from === h.to);
      if (out)
        add('answer', i, at, 0, (x) => {
          const row = x.gates[ta].rows.find((r) => r.box === h.to);
          if (row) Object.assign(row, { a: answer(out), fail: out.fail });
        });
    }
    set(i, at, reach(ta, tb));
    return at;
  };

  const c0 = s.summary ? 200 : 0;
  if (s.summary)
    add(
      null,
      -1,
      0,
      c0,
      (st, p) => {
        st.fade = 1 - p;
        if (p === 1) st.arcs = st.arcs.filter((a) => a.fail);
      },
      linear,
    );
  add('camera', -1, c0, s.summary ? 900 : CAM, () => {}, ease.out);
  const ends: number[] = [];
  hops.forEach((h, i) => {
    let dep = -1;
    for (let j = 0; j < i; j++) if (hops[j].to === h.from) dep = j;
    ends[i] = hop(i, dep >= 0 ? ends[dep] : CAM);
  });
  if (s.summary) {
    for (const a of st.path) s.frame.push(...A[a].lot.hull);
    if (s.truck && st.path.includes(T)) s.frame.push(...truckPts(s.truck));
    for (const u of Object.values(s.units)) if (['yard', 'gate', 'in'].includes(u.where)) s.frame.push(u.p, [u.p[0], u.p[1] + 40]);
    A.forEach((_, a) => s.gates[a].fail && s.frame.push(...gateEnds(a)));
  }
  return { steps, start, scratch: s, end: Math.max(s.summary ? c0 + 900 : CAM, ...ends) };
}

export function timeline(sc: Scene, story: number, moment: number): { events: Ev[]; end: number } {
  const { steps, end } = plan(sc, story, moment);
  return { events: steps.flatMap(({ kind, hop, start, end }) => (kind ? [{ kind, hop, start, end }] : [])), end };
}

export function stateAt(sc: Scene, story: number, moment: number, t: number): State {
  if (moment < 0) return fresh(sc, story);
  const { steps, start, scratch } = plan(sc, story, moment);
  const s = structuredClone(start),
    hopEnd: number[] = [];
  for (const e of steps) if (e.hop >= 0) hopEnd[e.hop] = Math.max(hopEnd[e.hop] ?? 0, e.end);
  let best = -1;
  for (const e of [...steps].sort((a, b) => a.start - b.start)) {
    if (e.start > t) continue;
    const raw = e.end > e.start ? Math.min(1, (t - e.start) / (e.end - e.start)) : 1,
      p = e.curve(raw);
    e.apply(s, p);
    const head = raw < 1 && e.hop >= 0 && hopEnd[e.hop] >= best ? e.head?.(s, p) : undefined;
    if (head) [s.lead, best] = [head, hopEnd[e.hop]];
  }
  s.frame = [...scratch.frame];
  s.hi = s.summary ? (t === Infinity ? [...sc.stories[story].path] : []) : [...scratch.hi];
  return s;
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Cam = { x: number; y: number; z: number };
export type Stage = { w: number; h: number; narrow: boolean; form: Form; region: { l: number; t: number; r: number; b: number } };
type Mark = '✓' | '✗' | '';
export type Tag = {
  actor: number;
  r: Rect;
  anchor: Pt;
  pin?: 'l' | 'r' | 't' | 'b';
  line: [Pt, Pt];
  name: string;
  status: string;
  mark: Mark;
  quiet: boolean;
  end: boolean;
  cargo: { thing: string; fail: boolean }[];
};
export type Sign = { actor: number; r: Rect; anchor: Pt; rows: { q: string; a: string; fail: boolean }[]; kick: boolean };
export type Chip = { text: string; r: Rect; mark?: Mark };
export type Placed = {
  cam: Cam;
  tags: Tag[];
  signs: Sign[];
  chips: Chip[];
  devices: { actor: number; r: Rect }[];
  gates: { actor: number; r: Rect }[];
  hulls: Pt[][];
  truck?: Pt[];
  arcs: Pt[][];
  faults: number;
};
type Opt = Rect & { anchor: Pt };

export const ZMIN = 0.45;
const OVER = new Error('over');
const GAP = 12,
  MARGIN = 32,
  TYPE = {
    big: { name: 14.8, hero: 16, kick: 12, status: 13.8, mark: 20, tag: 46, q: 15, a: 13, row: 30, chip: 13, chipH: 26 },
    small: { name: 13, hero: 14, kick: 0, status: 12, mark: 18, tag: 41, q: 13, a: 12, row: 24, chip: 12, chipH: 22 },
  };
const chipped = (u: Unit, summary: boolean) =>
  u.where === 'yard' || u.where === 'gate' || (summary && (u.where === 'bed' || u.where === 'in'));
const phoneScale = (z: number, st: Stage) => (st.narrow ? 1 : Math.min(1.9, Math.max(1, 0.85 / z)));
const nearest = (r: Rect, p: Pt): Pt => [Math.max(r.x, Math.min(p[0], r.x + r.w)), Math.max(r.y, Math.min(p[1], r.y + r.h))];
const rings = new Map<string, number[]>();
function ring(p: Pt, w: number, h: number, ds: number[]): Opt[] {
  const key = `${w},${h},${ds}`;
  let off = rings.get(key);
  if (!off) {
    const side = (c: number, size: number) => (c > 0.38 ? [0] : c < -0.38 ? [size] : [size / 2, size * 0.1, size * 0.9]);
    off = [];
    for (const d of ds)
      for (let i = 0; i < 16; i++) {
        const c = Math.cos((i * Math.PI) / 8),
          n = Math.sin((i * Math.PI) / 8);
        for (const sx of side(c, w)) for (const sy of side(n, h)) off.push(c * d - sx, n * d - sy);
      }
    rings.set(key, off);
  }
  const out: Opt[] = [];
  for (let i = 0; i < off.length; i += 2) out.push({ x: p[0] + off[i], y: p[1] + off[i + 1], w, h, anchor: p });
  return out;
}
type Cands<T> = (T[] | (() => T[]))[];
const area = (ps: Pt[]) =>
  Math.abs(ps.reduce((n, p, i) => n + p[0] * ps[(i + 1) % ps.length][1] - ps[(i + 1) % ps.length][0] * p[1], 0)) / 2;
function share(ps: Pt[], { l, t, r, b }: Stage['region']) {
  let out = ps;
  for (const [k, v, lo] of [
    [0, l, 1],
    [0, r, 0],
    [1, t, 1],
    [1, b, 0],
  ] as const) {
    const keep = (p: Pt) => (lo ? p[k] >= v : p[k] <= v),
      next: Pt[] = [];
    out.forEach((p, i) => {
      const q = out[(i + 1) % out.length];
      if (keep(p)) next.push(p);
      if (keep(p) !== keep(q)) {
        const u = (v - p[k]) / (q[k] - p[k]);
        next.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
      }
    });
    out = next;
  }
  return out.length > 2 ? area(out) / area(ps) : 0;
}
const bounds = (ps: Pt[]): Rect => {
  const xs = ps.map((p) => p[0]),
    ys = ps.map((p) => p[1]),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
// Measured system-ui widths in Chromium run up to 1.105x the textWidth estimate.
const widths = new Map<string, number>();
const width = (text: string, size: number, bold: boolean) => {
  const k = `${size}${bold}${text}`;
  let w = widths.get(k);
  if (w === undefined) widths.set(k, (w = textWidth(text, size) * (bold ? 1.06 : 1) * 1.12));
  return w;
};

export const hit = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const axes = new WeakMap<Pt[], number[]>();
export function polyHit(poly: Pt[], r: Rect, pad = 0): boolean {
  const x0 = r.x - pad,
    y0 = r.y - pad,
    x1 = r.x + r.w + pad,
    y1 = r.y + r.h + pad;
  let ax = axes.get(poly);
  if (!ax) {
    let px0 = Infinity,
      px1 = -Infinity,
      py0 = Infinity,
      py1 = -Infinity;
    for (const [x, y] of poly) {
      px0 = Math.min(px0, x);
      px1 = Math.max(px1, x);
      py0 = Math.min(py0, y);
      py1 = Math.max(py1, y);
    }
    ax = [px0, px1, py0, py1];
    for (let i = 0; i < poly.length; i++) {
      const [qx, qy] = poly[i],
        [bx, by] = poly[(i + 1) % poly.length],
        nx = by - qy,
        ny = qx - bx;
      let p0 = Infinity,
        p1 = -Infinity;
      for (const [x, y] of poly) {
        const v = x * nx + y * ny;
        if (v < p0) p0 = v;
        if (v > p1) p1 = v;
      }
      ax.push(nx, ny, p0, p1);
    }
    axes.set(poly, ax);
  }
  if (ax[1] <= x0 || x1 <= ax[0] || ax[3] <= y0 || y1 <= ax[2]) return false;
  for (let i = 4; i < ax.length; i += 4) {
    const nx = ax[i],
      ny = ax[i + 1],
      lo = Math.min(x0 * nx, x1 * nx) + Math.min(y0 * ny, y1 * ny),
      hi = Math.max(x0 * nx, x1 * nx) + Math.max(y0 * ny, y1 * ny);
    if (ax[i + 3] <= lo || hi <= ax[i + 2]) return false;
  }
  return true;
}

export function stageFor(w: number, h: number, sheet: number = HUD.sheet): Stage {
  const side = w >= HUD.wide || (h < HUD.short && w >= HUD.slim * 2);
  return {
    w,
    h,
    narrow: w < HUD.roomy,
    form: w >= HUD.slim * 2 ? (w < HUD.roomy ? 'narrow' : 'wide') : h < 740 || h > 780 ? 'spread' : 'stack',
    region: side
      ? { l: HUD.pad * 2 + (w >= HUD.wide ? HUD.panel : HUD.slim), t: HUD.chips + HUD.pad, r: w - HUD.pad, b: h - HUD.pad }
      : { l: 8, t: HUD.chips + 8, r: w - 8, b: h - sheet - 8 },
  };
}

const samples = new WeakMap<Arc[], Pt[][]>();
const chunks = new WeakMap<Pt[][], { ps: Pt[]; box: Rect }[]>();
const solidsOf = new WeakMap<Scene, { h: Pt[]; box: Rect }[]>();

export function layout(sc: Scene, s: State, stage: Stage, cam: Cam, full = false, cap = Infinity) {
  const ty = TYPE[stage.w < HUD.slim * 2 ? 'small' : 'big'],
    CHIP_H = ty.chipH;
  const A = sc.actors,
    story = sc.stories[s.story],
    k = kit(sc, s),
    { l, t, r, b } = stage.region,
    cx = (l + r) / 2,
    cy = (t + b) / 2;
  const pr = (p: Pt): Pt => [(p[0] - cam.x) * cam.z + cx, (p[1] - cam.y) * cam.z + cy];
  const span = (ps: Pt[]) => bounds(ps.map(pr));
  const truckW = s.truck && !k.parked() ? k.truckPts(s.truck, phoneScale(cam.z, stage)) : null;
  const gates = A.flatMap((a, i) => {
    const g = a.gate,
      st = s.gates[i];
    if (!a.checks || (st.on !== s.moment && !st.fail)) return [];
    const up = st.deg > 1 ? g.z + g.L : st.fail ? g.z + 1 : g.z + 0.3;
    return [{ actor: i, r: span([P(g.px - 0.35, g.y), P(g.ex + 0.12, g.y), P(g.px, g.y, up), P(g.ex, g.y, g.z)]) }];
  });
  const grow = phoneScale(cam.z, stage);
  const devices = s.dev
    .filter((a) => !k.inCab(a))
    .map((a) => {
      const p = k.devBase(a);
      return {
        actor: a,
        r: span([
          [p[0] - (PHONE.w * grow) / 2, p[1] - PHONE.h * grow],
          [p[0] + (PHONE.w * grow) / 2, p[1]],
        ]),
      };
    });
  let arcsW = samples.get(s.arcs);
  if (!arcsW)
    samples.set(
      s.arcs,
      (arcsW = s.arcs
        .filter((a) => a.t > 0)
        .map((a) =>
          sc.bends.length
            ? Array.from({ length: 97 }, (_, i) => bez(a, (a.t * i) / 96))
            : Array.from({ length: 33 }, (_, i) => bez(a, a.t * (0.05 + (0.9 * i) / 32))),
        )),
    );
  let lots = solidsOf.get(sc);
  if (!lots) solidsOf.set(sc, (lots = A.map((a) => ({ h: a.lot.hull, box: bounds(a.lot.hull) }))));
  const taken: Rect[] = [...devices, ...gates].map((d) => d.r);
  let bad = 0;
  const inRegion = (o: Rect) => o.x >= l && o.y >= t && o.x + o.w <= r && o.y + o.h <= b;
  const truckHull = truckW ? hull(truckW) : undefined;
  const solids = truckHull ? [...lots, { h: truckHull, box: bounds(truckHull) }] : lots;
  const world = (o: Rect): Rect => ({ x: (o.x - cx) / cam.z + cam.x, y: (o.y - cy) / cam.z + cam.y, w: o.w / cam.z, h: o.h / cam.z });
  const offB = (o: Rect) => {
    const q = world(o),
      p = 2 / cam.z;
    return !solids.some(({ h, box }) => hit(box, q, p) && polyHit(h, q, p));
  };
  let parts = chunks.get(arcsW);
  if (!parts)
    chunks.set(
      arcsW,
      (parts = arcsW.flatMap((arc) =>
        Array.from({ length: Math.ceil(arc.length / 8) }, (_, k) => {
          const ps = arc.slice(k * 8, k * 8 + 8);
          return { ps, box: bounds(ps) };
        }),
      )),
    );
  const offA = (o: Rect) => {
    const q = world(o),
      p = 4 / cam.z;
    const x0 = q.x - p,
      x1 = q.x + q.w + p,
      y0 = q.y - p,
      y1 = q.y + q.h + p;
    for (const { ps, box } of parts)
      if (hit(box, q, p)) for (const c of ps) if (c[0] > x0 && c[0] < x1 && c[1] > y0 && c[1] < y1) return false;
    return true;
  };
  const free = (o: Rect) => !taken.some((x) => hit(x, o, 6));
  const ok = (o: Rect) => inRegion(o) && free(o) && offA(o) && offB(o);
  const scan = <T extends Rect>(cands: Cands<T>, test: (o: T) => boolean) => {
    for (const c of cands) for (const o of typeof c === 'function' ? c() : c) if (test(o)) return o;
  };
  const clean = <T extends Rect>(cands: Cands<T>) => scan(cands, ok);
  const pick = <T extends Rect>(cands: Cands<T>): T => {
    const o = scan(cands, ok);
    if (o) return o;
    if (++bad > cap) throw OVER;
    return scan(cands, (o) => inRegion(o) && free(o)) ?? (cands[0] as T[])[0];
  };

  const tags: Tag[] = [];
  const tagOf = (a: number) => {
    const ev = s.ever[a],
      name = A[a].name,
      status = ev ? named(ev, s.summary) : 'Not reached',
      mark: Mark = ev ? (ev.fail ? '✗' : '✓') : '',
      end = s.summary && sc.boxes[story.end]?.actor === a,
      bed = !stage.narrow && s.summary && a === sc.truck ? Object.values(s.units).filter((u) => u.where === 'bed' && u.moment >= 0) : [],
      cargo = [...new Set(bed.map((u) => u.thing))].map((thing) => ({ thing, fail: bed.some((u) => u.thing === thing && u.fail) })),
      w =
        (end ? 22 : 20) +
        Math.max(
          width(name, end ? ty.hero : ty.name, true),
          ty.mark + width(status, ty.status, false),
          ...cargo.map((c) => 20 + width(c.thing, 13, true)),
        ),
      h = ty.tag + (end ? 3 : 0) + cargo.length * 20,
      g = GAP,
      onTruck = a === sc.truck && truckW,
      top = onTruck ? truckW.reduce((m, p) => (p[1] < m[1] ? p : m)) : A[a].lot.tag,
      [ax, ay] = pr(top),
      anchor: Pt = [ax, ay];
    const opts: Opt[] = [];
    if (onTruck) {
      const [bx, by] = pr(truckW.reduce((m, p) => (p[1] > m[1] ? p : m)));
      for (const x of [bx - w / 2, bx + 4, bx - w - 4]) opts.push({ x, y: by + g, w, h, anchor: [bx, by] });
    }
    for (const [x, y] of [
      [ax - w / 2, ay - g - h],
      [ax + g, ay - h / 2],
      [ax - g - w, ay - h / 2],
      [ax + 4, ay - g - h],
      [ax - w - 4, ay - g - h],
      [ax - w / 2, ay + g],
      [ax + g, ay - g - h],
      [ax - g - w, ay - g - h],
      [ax + g, ay + 4],
      [ax - g - w, ay + 4],
      [ax - w / 2, ay - 2 * g - h],
      [ax + 4, ay - 2 * g - h],
      [ax - w - 4, ay - 2 * g - h],
      [ax - w + 36, ay - g - h],
      [ax - 36, ay - g - h],
    ])
      opts.push({ x, y, w, h, anchor });
    const phone = stage.w < HUD.slim * 2 && s.summary;
    const ds =
      stage.w < HUD.wide && s.summary && !(onTruck && phone) ? [12, 20, 30, 40] : stage.narrow ? [12, 20, 30, 44, 58] : [12, 18, 24];
    const cands: Cands<Opt> = [
      opts,
      () => ring(anchor, w, h, ds),
      () => (onTruck ? ring(pr(truckW.reduce((m, p) => (p[1] > m[1] ? p : m))), w, h, ds) : []),
      () => (onTruck && (!stage.narrow || phone) ? [] : ring(pr(A[a].lot.hull.reduce((m, p) => (p[1] > m[1] ? p : m))), w, h, ds)),
    ];
    const must = s.hi.includes(a) || (s.summary && story.path.includes(a));
    const part = share((onTruck ? truckHull! : A[a].lot.hull).map(pr), stage.region) < 0.6;
    if (part && !must) return;
    const base = { actor: a, name, status, mark, quiet: !story.path.includes(a), end, cargo };
    const out = ax < l || ax > r || ay < t || ay > b;
    if (must && stage.narrow && (out || part)) {
      const tag = pin(base, w, h, [ax, ay]);
      tags.push(tag);
      taken.push(tag.r);
      return;
    }
    if (part && ++bad > cap) throw OVER;
    const o = must ? pick(cands) : clean(cands);
    if (!o) return;
    const tr = { x: o.x, y: o.y, w, h };
    tags.push({ ...base, r: tr, anchor: o.anchor, line: [nearest(tr, o.anchor), o.anchor] });
    taken.push(o);
  };
  if ((!stage.narrow || (stage.w < HUD.slim * 2 && s.summary)) && truckW && s.hi.includes(sc.truck)) tagOf(sc.truck);

  const chips: Chip[] = [];
  const chip = (text: string, opts: Pt[], w: number, around: Pt[], mark?: Mark) => {
    for (const [px, py] of around)
      for (const d of [10, 30, 50])
        for (let i = 0; i < 8; i++) {
          const u = (i * Math.PI) / 4;
          opts.push([px + Math.cos(u) * (d + w / 2) - w / 2, py + Math.sin(u) * (d + CHIP_H / 2) - CHIP_H / 2]);
        }
    const rs = opts.map(([x, y]) => ({ x, y, w, h: CHIP_H }));
    const fits = (o: Rect) => inRegion(o) && offB(o) && free(o);
    const o = rs.find(fits) ?? around.flatMap((p) => ring(p, w, CHIP_H, stage.narrow ? [20, 30, 44, 58] : [18, 24])).find(fits);
    if (!o && ++bad > cap) throw OVER;
    chips.push({ text, r: o ?? rs[0], mark });
    taken.push(o ?? rs[0]);
  };
  for (const a of s.arcs) {
    if (a.moment !== s.moment || a.t !== 1 || !a.text || s.ever[a.to]?.label === a.text) continue;
    const w = 20 + width(a.text, ty.chip, true),
      g = 10;
    let top = a.a;
    for (let i = 0; i <= 40; i++) {
      const p = bez(a, i / 40);
      if (p[1] < top[1]) top = p;
    }
    const [px, py] = pr(top);
    const opts: Pt[] = [[px - w / 2, py - CHIP_H - g]];
    for (const u of [0.8, 0.2, 0.65, 0.35]) {
      const [qx, qy] = pr(bez(a, u));
      opts.push([qx + g, qy - CHIP_H / 2], [qx - g - w, qy - CHIP_H / 2]);
    }
    chip(
      a.text,
      opts,
      w,
      [0.5, 0.3, 0.7].map((u) => pr(bez(a, u))),
    );
  }
  const seen = new Set<string>();
  for (const u of Object.values(s.units)) {
    const at = s.summary && u.where === 'bed' ? truckW?.reduce((m, p) => (p[1] < m[1] ? p : m)) : u.p;
    if (
      (u.moment !== s.moment && !s.summary) ||
      u.moment < 0 ||
      !at ||
      !chipped(u, s.summary) ||
      seen.has(u.thing) ||
      (!stage.narrow && s.summary && u.where === 'bed')
    )
      continue;
    seen.add(u.thing);
    const mark = s.summary && !u.fail ? '✓' : undefined,
      w = 20 + (mark ? ty.mark : 0) + width(u.thing, ty.chip, true),
      g = 10,
      h = CHIP_H,
      [px, py] = pr([at[0], at[1] + 6]);
    chip(
      u.thing,
      [
        [px - w / 2, py + g],
        [px + g, py - h / 2],
        [px - g - w, py - h / 2],
        [px + g, py + g],
        [px - g - w, py + g],
        [px - w / 2, py + 3 * g],
      ],
      w,
      [[px, py]],
      mark,
    );
  }

  const signs: Sign[] = [];
  for (const g of gates) {
    const gs = s.gates[g.actor];
    if (!gs.rows.length || !(gs.on === s.moment || (s.summary && gs.fail && !stage.narrow))) continue;
    const rows = gs.rows.map(({ q, a, fail }) => ({ q, a: s.ever[g.actor]?.label === a ? '' : a, fail }));
    const w =
        22 +
        Math.max(
          width(A[g.actor].name, ty.kick, false),
          ...rows.map((x) => width(x.q, ty.q, true) + (x.a ? width(x.a, ty.a, true) + 40 : 26)),
        ),
      h = rows.length * ty.row + (rows.length - 1) * 6 + 14 + (ty.kick && 16);
    const gr = g.r,
      gate = A[g.actor].gate,
      foot = pr(P(gate.ex, gate.y)),
      bot = gr.y + gr.h,
      mid = gr.x + gr.w / 2,
      gy = gr.y + gr.h / 2;
    const ways = (
      [
        [mid - 14, gr.y - GAP - h, [mid, gr.y]],
        [mid - w + 14, gr.y - GAP - h, [mid, gr.y]],
        [gr.x + gr.w + GAP, gy - h / 2, [gr.x + gr.w, gy]],
        [gr.x - GAP - w, gy - h / 2, [gr.x, gy]],
        [gr.x + gr.w + GAP, bot - h, [gr.x + gr.w, bot - 4]],
        [gr.x - GAP - w, bot - h, [gr.x, bot - 4]],
        [foot[0] - 14, bot + GAP, foot],
        [foot[0] - w + 14, bot + GAP, foot],
        [mid - w / 2, bot + GAP, foot],
      ] as [number, number, Pt][]
    ).map(([x, y, anchor]) => ({ x, y, w, h, anchor }));
    const opts = stage.narrow ? [...ways.slice(6), ...ways.slice(0, 6)] : ways;
    const o = pick([opts, ...([foot, [mid, gr.y], [gr.x, gy], [gr.x + gr.w, gy]] as Pt[]).map((p) => () => ring(p, w, h, [12, 24]))]);
    signs.push({ actor: g.actor, r: { x: o.x, y: o.y, w, h }, anchor: o.anchor, rows, kick: !!ty.kick });
    taken.push(o);
  }

  const rank = (a: number) => (s.hi.includes(a) ? 0 : story.path.includes(a) ? 1 : 2);
  const order = A.map((_, a) => a).sort((p, q) => rank(p) - rank(q));
  for (const a of order) if (!tags.some((x) => x.actor === a)) tagOf(a);

  function pin(base: Omit<Tag, 'r' | 'anchor' | 'line'>, w: number, h: number, [ax, ay]: Pt): Tag {
    const over = { l: l - ax, r: ax - r, t: t - ay, b: ay - b };
    const side = (Object.keys(over) as Tag['pin'][]).reduce((m, e) => (over[e!] > over[m!] ? e : m))!;
    const across = side === 'l' || side === 'r';
    const lo = across ? t : l,
      hi = Math.max(lo, across ? b - h : r - w),
      at = Math.max(lo, Math.min(hi, across ? ay - h / 2 : ax - w / 2));
    const opts: Opt[] = [];
    for (let d = 0; d <= hi - lo; d += 8)
      for (const v of d ? [at - d, at + d] : [at]) {
        if (v < lo || v > hi) continue;
        const x = across ? (side === 'l' ? l : r - w) : v,
          y = across ? v : side === 't' ? t : b - h;
        opts.push({ x, y, w, h, anchor: [ax, ay] });
      }
    const o = pick([opts]);
    const tr = { x: o.x, y: o.y, w, h };
    return { ...base, r: tr, anchor: o.anchor, line: [nearest(tr, o.anchor), o.anchor], pin: side };
  }

  for (const g of signs) {
    const tr = tags.find((x) => x.actor === g.actor)?.r,
      r = g.r;
    if (!g.kick || !tr || Math.max(tr.x - r.x - r.w, r.x - tr.x - tr.w, tr.y - r.y - r.h, r.y - tr.y - tr.h) > 120) continue;
    g.kick = false;
    g.r = { ...r, y: g.anchor[1] > r.y + r.h - 16 ? r.y + 16 : r.y, h: r.h - 16 };
  }
  bad += devices.filter((d) => !inRegion(d.r) || !offB(d.r)).length + gates.filter((g) => s.summary && !inRegion(g.r)).length;
  const placed: Placed = {
    cam,
    tags,
    signs,
    chips,
    devices,
    gates,
    hulls: full ? A.map((a) => a.lot.hull.map(pr)) : [],
    truck: full && truckW ? hull(truckW.map(pr)) : undefined,
    arcs: full ? arcsW.map((arc) => arc.map(pr)) : [],
    faults: bad,
  };
  return { placed, bad, pr };
}

export function place(sc: Scene, s: State, stage: Stage, top = stage.narrow ? 1 : stage.w >= 1800 ? 1.3 : 1.2): Placed {
  const kt = kit(sc, s),
    last = s.summary && stage.w < HUD.wide ? sc.stories[s.story].moments.slice(-3, -1).flat() : [],
    near = [...new Set(last.flatMap((h) => [sc.boxes[h.from]?.actor, sc.boxes[h.to]?.actor]))].filter((a) => a !== undefined),
    pts = near.length
      ? [
          ...near.flatMap((a) => (a === sc.truck && s.truck && !kt.parked() ? kt.truckPts(s.truck) : sc.actors[a].lot.hull)),
          ...sc.actors.flatMap((a, i) => (s.gates[i].fail ? kt.gateEnds(i) : [])),
        ]
      : s.frame.length
        ? s.frame
        : sc.actors.flatMap((a) => a.lot.hull);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  const y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  if (x1 - x0 < 520) [x0, x1] = [(x0 + x1) / 2 - 260, (x0 + x1) / 2 + 260];
  const { l, t, r, b } = stage.region,
    rw = r - l,
    rh = b - t,
    pad = stage.narrow ? 0 : MARGIN;
  const k = kit(sc, s),
    need: [Pt, number][] = [];
  sc.actors.forEach(({ checks, gate: g }, a) => {
    const gs = s.gates[a];
    if (checks && gs.rows.length && (gs.on === s.moment || (s.summary && gs.fail))) need.push([P(g.px, g.y), 24], [P(g.ex, g.y), 24]);
  });
  for (const a of s.dev) if (!k.inCab(a)) need.push([k.devBase(a), 0], [k.devTop(a), 0]);
  for (const a of s.arcs) if (a.moment === s.moment && a.t === 1 && a.text) need.push([bez(a, 0.5), 80]);
  for (const u of Object.values(s.units))
    if ((u.moment === s.moment || s.summary) && u.moment >= 0 && chipped(u, s.summary))
      need.push([u.where === 'bed' ? k.truckPts(s.truck!).reduce((m, p) => (p[1] < m[1] ? p : m)) : u.p, 80]);
  const soft = s.dev.filter(k.inCab).map(k.devTop);
  const arcPts = s.arcs.filter((a) => a.t > 0).flatMap((a) => Array.from({ length: 9 }, (_, i) => bez(a, (a.t * i) / 8)));
  if (!stage.narrow) for (const p of arcPts) need.push([p, -14]);
  const inside = (c: Cam, x: number, y: number, m: number) => {
    const px = (x - c.x) * c.z + (l + r) / 2,
      py = (y - c.y) * c.z + (t + b) / 2;
    return px >= l - m && px <= r + m && py >= t - m && py <= b + m;
  };
  const holds = (c: Cam) => need.every(([[x, y], m]) => inside(c, x, y, m));
  const fit = (c: Cam) => {
    const lay = layout(sc, s, stage, c);
    const rects = (stage.narrow ? [...lay.placed.signs, ...lay.placed.tags, ...lay.placed.devices, ...lay.placed.chips] : []).map(
      (o) => o.r,
    );
    const sp = [...pts, ...arcPts, ...soft].map(lay.pr);
    const L = Math.min(...rects.map((o) => o.x), ...sp.map((p) => p[0])),
      R = Math.max(...rects.map((o) => o.x + o.w), ...sp.map((p) => p[0])),
      T = Math.min(...rects.map((o) => o.y), ...sp.map((p) => p[1])),
      B = Math.max(...rects.map((o) => o.y + o.h), ...sp.map((p) => p[1]));
    return { lay, L, R, T, B };
  };
  const search = (floor: number) => {
    let best: ReturnType<typeof layout> | null = null,
      last: ReturnType<typeof layout> | undefined;
    let z = Math.max(floor, Math.min((rw - pad) / (x1 - x0), (rh - 2 * pad) / (y1 - y0), top));
    for (let n = 0; n < 60 && z >= floor; n++, z *= 0.96) {
      let c: Cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
      for (let round = 0; round < 3; round++) {
        const f = fit(c);
        last = f.lay;
        if (round < 2) {
          c = { x: c.x + ((f.L + f.R) / 2 - (l + r) / 2) / z, y: c.y + ((f.T + f.B) / 2 - (t + b) / 2) / z, z };
          continue;
        }
        if (f.R - f.L <= rw - pad && f.B - f.T <= rh - 2 * pad) {
          if (!f.lay.bad && holds(c)) return { lay: f.lay, ok: true };
          if (!best || f.lay.bad < best.bad) best = f.lay;
        }
      }
    }
    return { lay: best ?? last!, ok: false };
  };
  const whole = search(Math.min(stage.narrow ? ZMIN : 0.3, top));
  const done = (lay: ReturnType<typeof layout>) => layout(sc, s, stage, lay.placed.cam, true).placed;
  if (whole.ok) return done(whole.lay);
  const ref = stage.narrow ? Math.min(ZMIN, top) : whole.lay.placed.cam.z;
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const story = sc.stories[s.story],
    lift = s.truck && !k.parked() ? k.truckPts(s.truck).reduce((m, p) => (p[1] < m[1] ? p : m)) : null,
    must = sc.actors.flatMap((a, i) =>
      s.hi.includes(i) || (s.summary && story.path.includes(i)) ? [i === sc.truck && lift ? lift : a.lot.tag] : [],
    );
  const pins = (c: Cam) => (stage.narrow ? must.filter(([x, y]) => !inside(c, x, y, 0)).length : 0);
  const misses: { c: Cam; bad: number }[] = [];
  let tries = 0;
  const score = (c: Cam, d: number) => d + Math.abs(c.z - ref) * 1000 + pins(c) * 300;
  const first = (cams: { c: Cam; score: number }[]) => {
    for (const { c } of cams.sort((p, q) => p.score - q.score)) {
      if (!holds(c)) continue;
      if (++tries > TRIES) return;
      const cap = misses.length < 4 ? Infinity : misses.map((m) => m.bad).sort((p, q) => p - q)[3];
      try {
        const lay = layout(sc, s, stage, c, false, cap);
        if (!lay.bad) return lay;
        misses.push({ c, bad: lay.bad });
      } catch (e) {
        if (e !== OVER) throw e;
      }
    }
  };
  const grid = (aim: { x: number; y: number }, zs: number[]) =>
    first(
      zs.flatMap((z) =>
        SHIFT.flatMap((dy) =>
          SHIFT.map((dx) => {
            const c = { x: aim.x + dx / z, y: aim.y + dy / z, z };
            return { c, score: score(c, Math.hypot(dx, dy)) };
          }),
        ),
      ),
    );
  const refine = () =>
    first(
      misses
        .sort((p, q) => p.bad - q.bad)
        .slice(0, 4)
        .flatMap(({ c }) =>
          NUDGE.flatMap((dy) =>
            NUDGE.map((dx) => {
              const n = { x: c.x + dx / c.z, y: c.y + dy / c.z, z: c.z };
              return { c: n, score: score(n, Math.hypot(n.x - mid.x, n.y - mid.y) * c.z) };
            }),
          ),
        ),
    );
  const zs = [...new Set([0, 1, 2, 3, 4, 5].map((i) => Math.min(top, stage.narrow ? ZMIN + i * 0.1 : ref * (1 - i * 0.08))))],
    far = [0.4, 0.35, 0.3, 0.25].filter((z) => z < Math.min(...zs));
  return done(grid(focus(sc, s) ?? mid, zs) ?? grid(mid, zs) ?? grid(mid, far) ?? refine() ?? whole.lay);
}
export function storyCams(sc: Scene, story: number, stage: Stage): Placed[] {
  const n = sc.stories[story].moments.length,
    out: Placed[] = [];
  if (!n) return out;
  out[n - 1] = place(sc, stateAt(sc, story, n - 1, Infinity), stage);
  for (let m = n - 2; m >= 0; m--)
    out[m] = place(
      sc,
      stateAt(sc, story, m, Infinity),
      stage,
      Math.min(stage.narrow ? 1 : stage.w >= 1800 ? 1.3 : 1.2, out[m + 1].cam.z * (m === n - 2 && stage.w < HUD.wide ? 1 : 1.2)),
    );
  const fit = out[n - 1].cam.z,
    xs = sc.stories[story].path.flatMap((a) => sc.actors[a].lot.hull.map((p) => p[0])),
    aim =
      stage.w < HUD.wide
        ? out[n - 2].cam.z * 2
        : (Math.max(...xs) - Math.min(...xs)) * fit < 0.7 * (stage.region.r - stage.region.l)
          ? out[n - 2].cam.z * 0.92
          : out[n - 2].cam.z * 1.2;
  const end = stateAt(sc, story, n - 1, Infinity);
  if (fit > aim) {
    const back = place(sc, end, stage, aim);
    if (!back.faults) out[n - 1] = back;
  }
  return out;
}
export function storyView(get: (form: Form) => Scene, story: number, stage: Stage): { sc: Scene; cams: Placed[] } {
  const forms: Form[] = stage.form === 'stack' || stage.form === 'spread' ? [stage.form, 'narrow'] : [stage.form];
  let view = { sc: get(forms[0]), cams: [] as Placed[] };
  for (const f of forms) {
    view = { sc: get(f), cams: storyCams(get(f), story, stage) };
    if (!view.cams.some((p) => p.faults)) break;
  }
  return view;
}
const SHIFT = Array.from({ length: 13 }, (_, i) => (i - 6) * 40),
  NUDGE = [-30, -20, -10, 0, 10, 20, 30],
  TRIES = 400;

function focus(sc: Scene, s: State): { x: number; y: number } | null {
  if (s.lead) return { x: s.lead[0], y: s.lead[1] };
  const hops = sc.stories[s.story].moments[s.moment] ?? [];
  const ends: number[] = [];
  for (const e of plan(sc, s.story, s.moment).steps) if (e.hop >= 0) ends[e.hop] = Math.max(ends[e.hop] ?? 0, e.end);
  let last = -1;
  ends.forEach((e, i) => (last = last < 0 || e >= ends[last] ? i : last));
  const a = last >= 0 ? sc.boxes[hops[last].to]?.actor : undefined;
  const m = a === undefined ? undefined : mean(sc.actors[a].lot.hull);
  return m ? { x: m[0], y: m[1] } : null;
}

export type World = {
  show(story: number, moment: number, motion: boolean, say: string): number;
  fits(story: number): boolean;
  stop(): void;
};

const OV = '#141A22',
  OV2 = '#4B5361',
  OVM = '#646C79',
  RIM = 'rgba(20,26,34,.16)';
const OV_CSS = [
  `[data-stage=world]{overflow:hidden}[data-stage=world]>svg,.fw-ov>svg{position:absolute;inset:0;width:100%;height:100%}`,
  `.bld{transition:opacity .3s,filter .3s}.bld.quiet{opacity:.4;filter:saturate(.15)}.pad{opacity:0;transition:opacity .3s}.pad.on{opacity:1}`,
  `.fw-ov{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:var(--flowfig-font);color:${OV}}`,
  `.fw-tag,.fw-sign,.fw-dchip{position:absolute;left:0;top:0;box-sizing:border-box;overflow:hidden;white-space:nowrap;background:#fff;border:1px solid ${RIM};transition:opacity .2s}`,
  `.fw-tag{padding:4px 9px;border-radius:6px}`,
  `.fw-tn{display:block;font:600 14.8px/19px var(--flowfig-font);color:${OV}}`,
  `.fw-ts{display:flex;font:400 13.8px/17px var(--flowfig-font);color:${OV2}}`,
  `.fw-mk{display:inline-grid;place-items:center;flex:none;width:14px;height:14px;margin:2px 6px 0 0;border-radius:3px;background:${OV};color:#fff;font:700 10px/1 var(--flowfig-font);font-style:normal}`,
  `.fw-no{color:${INK.fail}}.fw-no>.fw-mk{background:${INK.fail}}.fw-dchip>.fw-mk{margin-top:0}`,
  `.fw-tag{transition:opacity .2s,border-color .16s .2s,background-color .16s .2s}.fw-end{border:2px solid ${OV};background:#EEF1EA}.fw-end.fw-x{border-color:${INK.fail};background:#FCEBE8}.fw-end .fw-tn{font-size:16px;line-height:20px}`,
  `.fw-cg{font:500 13px/20px var(--flowfig-font)}`,
  `.fw-sk{font:500 12px/16px var(--flowfig-font);color:#5B6370}`,
  `.fw-quiet .fw-tn,.fw-quiet .fw-ts{color:${OVM}}`,
  `.fw-sign{padding:6px 10px;border-radius:8px}`,
  `.fw-row{display:flex;align-items:center;justify-content:space-between;height:30px}.fw-row+.fw-row{margin-top:6px}`,
  `.fw-q{font:600 15px/20px var(--flowfig-font);color:${OV}}`,
  `.fw-a{margin-left:12px;padding:0 6px;border-radius:5px;font:600 13px/24px var(--flowfig-font);background:#EEF1EA;color:${OV}}`,
  `.fw-a.fw-no{background:#FCEBE8;color:${INK.fail}}.fw-a.fw-no::before{content:"\\2717";margin-right:4px}`,
  `.fw-a.fw-m{display:inline-grid;place-items:center;width:14px;height:14px;padding:0;border-radius:3px;font:700 10px/1 var(--flowfig-font)}.fw-a.fw-m::before{content:none}`,
  `.fw-dchip{display:flex;align-items:center;padding:0 9px;border-radius:6px;font:600 13px/1 var(--flowfig-font);color:${INK.data}}`,
  `.fw-dchip.fw-thing{color:${OV}}.fw-dchip{transition:opacity .2s,scale .2s cubic-bezier(.23,1,.32,1)}.fw-dchip.fw-off{scale:.96}.gt{transition:opacity .2s}`,
  `.fw-off{opacity:0}`,
  `@container ff-guide (width < ${HUD.slim * 2}px){.fw-tn{font-size:13px;line-height:16px}.fw-ts{font-size:12px;line-height:15px}.fw-mk{margin:1px 4px 0 0}.fw-sk{display:none}.fw-end .fw-tn{font-size:14px;line-height:17px}.fw-row{height:24px}.fw-q{font-size:13px;line-height:17px}.fw-a{font-size:12px;line-height:20px}.fw-dchip{font-size:12px}}`,
].join('');

const f1 = (n: number) => n.toFixed(1);
const pt = (p: Pt) => `${f1(p[0])},${f1(p[1])}`;
const cut = (r: Route, t: number): Route[] => {
  const ab = lerp(r.a, r.c1, t),
    bc = lerp(r.c1, r.c2, t),
    cd = lerp(r.c2, r.b, t),
    abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t),
    m = lerp(abc, bcd, t);
  return [
    { a: r.a, c1: ab, c2: abc, b: m },
    { a: m, c1: bcd, c2: cd, b: r.b },
  ];
};
const arcPart = (r: Route, u0: number, u1: number) => {
  let s = u0 > 0 ? cut(r, u0)[1] : r;
  if (u1 < 1) s = cut(s, (u1 - u0) / (1 - u0))[0];
  return `M${pt(s.a)}C${pt(s.c1)} ${pt(s.c2)} ${pt(s.b)}`;
};
const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const put = (e: HTMLElement, r: Rect) => {
  e.style.transform = `translate(${f1(r.x)}px,${f1(r.y)}px)`;
  e.style.width = `${f1(r.w)}px`;
  e.style.height = `${f1(r.h)}px`;
};
const same = (e: Node, text: string) => {
  if (e.textContent !== text) e.textContent = text;
};

let sheet: CSSStyleSheet | undefined;

export function mountWorld(stage: HTMLElement, fig: FlowProps, resized: () => void, hud: (story: number) => number): World {
  const root = stage.getRootNode() as ShadowRoot;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(OV_CSS);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  stage.dataset.stage = 'world';
  const scenes: Partial<Record<Form, Scene>> = {},
    get = (form: Form) => (scenes[form] ??= scene(fig, form));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  const ov = el('div', 'fw-ov');
  stage.append(svg, ov);
  const q = (sel: string) => svg.querySelector<SVGGraphicsElement>(sel);
  const unitEls = new Map<string, SVGGElement>();
  let sc = get('narrow');
  const mount = () => {
    const art = sc.truckArt;
    svg.innerHTML =
      `<g class="fw-cam">${sc.svg}${art?.door ?? ''}<g class="fw-units"></g>${art?.road ?? ''}` +
      sc.actors.map((a, i) => (a.device === 'antenna' ? '' : `<g class="fw-dev" data-a="${i}">${PHONE.svg}</g>`)).join('') +
      `<g class="fw-arcs"></g></g>`;
    unitEls.clear();
    return {
      art,
      depot: sc.truck >= 0 ? sc.actors[sc.truck].lot.depot : null,
      camG: q('.fw-cam')!,
      unitsG: q('.fw-units')!,
      arcsG: q('.fw-arcs')!,
      doorPanel: q('#doorPanel'),
      devs: new Map([...svg.querySelectorAll<SVGGElement>('.fw-dev')].map((g) => [Number(g.dataset.a), g])),
      arms: [...svg.querySelectorAll('.arm')],
      arms2: [...svg.querySelectorAll('.armW')],
      hubs: [...svg.querySelectorAll('.hub')],
      gts: [...svg.querySelectorAll<SVGGElement>('.gt')],
      checkers: sc.actors.flatMap((a, i) => (a.checks ? [i] : [])),
    };
  };
  let d = mount();
  const show = (e: Element | null, on: boolean) => e?.setAttribute('display', on ? 'inline' : 'none');
  const move = (e: Element | null, p: Pt, k = 1) =>
    e?.setAttribute('transform', `translate(${f1(p[0])} ${f1(p[1])})${k === 1 ? '' : ` scale(${k})`}`);

  let stg = stageFor(0, 0),
    cam: Cam | undefined,
    cur: { story: number; moment: number } | undefined,
    raf = 0,
    built = '',
    said = '';
  const lays = new Map<number, ReturnType<typeof storyView>>();
  let tags: { el: HTMLElement; actor: number; name: string; mk: HTMLElement; st: HTMLElement; end: boolean; w: string }[] = [],
    signs: { el: HTMLElement; actor: number; rows: { q: HTMLElement; a: HTMLElement; m: boolean }[] }[] = [],
    chips: { el: HTMLElement; text: string }[] = [];

  const stageOf = (story: number) => stageFor(stg.w, stg.h, hud(story));
  const viewFor = (story: number) => lays.get(story) ?? lays.set(story, storyView(get, story, stageOf(story))).get(story)!;
  const use = (s: Scene) => {
    if (s === sc) return;
    sc = s;
    d = mount();
    built = '';
    cam = undefined;
  };
  const layoutFor = (story: number, moment: number) => {
    const v = viewFor(story);
    use(v.sc);
    return v.cams[moment];
  };

  function draw(s: State, c: Cam) {
    const { l, t, r, b } = stg.region;
    d.camG.setAttribute(
      'transform',
      `translate(${f1((l + r) / 2)} ${f1((t + b) / 2)}) scale(${c.z.toFixed(4)}) translate(${f1(-c.x)} ${f1(-c.y)})`,
    );
    const k = kit(sc, s);
    const out = !!s.truck && !k.parked();
    if (s.truck && d.depot) {
      const tk = s.truck;
      for (const [id, o] of [
        ['#truck', 'L'],
        ['#truckR', 'R'],
        ['#truckY', 'y'],
        ['#truckD', 'D'],
        ['#truckU', 'U'],
      ]) {
        show(q(id), tk.orient === o);
        move(q(id), P(tk.x, tk.y - ('LR'.includes(o) ? LANE - TD / 2 : 0)));
      }
      const dy = d.depot.y + 0.004,
        x0 = d.depot.x + 0.3,
        x1 = d.depot.x + 1.8,
        zb = 1.03 * tk.door;
      const quad = (z0: number, z1: number, fill: string) =>
        `<polygon points="${[P(x0, dy, z0), P(x1, dy, z0), P(x1, dy, z1), P(x0, dy, z1)].map(pt).join(' ')}" fill="${fill}"/>`;
      let o = quad(zb, 1.03, '#3b463d');
      for (let i = 0; i < 9; i++) {
        const z = 0.1 + i * 0.105;
        if (z > zb) o += quad(z, Math.min(1.03, z + 0.035), '#56645a');
      }
      if (d.doorPanel && d.doorPanel.dataset.k !== o) {
        d.doorPanel.innerHTML = o;
        d.doorPanel.dataset.k = o;
      }
      for (const side of 'lrdu')
        for (let i = 0; i < 8; i++) {
          const e = q(`#t${side}${i}`),
            u = tk.load[i] ? sc.things.get(s.units[tk.load[i]].thing)?.form : undefined;
          if (e && e.dataset.k !== (u ?? '')) {
            e.innerHTML = u ? UNIT[u] : '';
            e.dataset.k = u ?? '';
          }
        }
    }
    for (const [id, u] of Object.entries(s.units)) {
      let g = unitEls.get(id);
      if (!g) {
        g = document.createElementNS(NS, 'g');
        g.innerHTML = UNIT[sc.things.get(u.thing)?.form ?? 'box'];
        d.unitsG.append(g);
        unitEls.set(id, g);
      }
      const on = u.where === 'yard' || u.where === 'road' || u.where === 'gate' || u.where === 'air';
      show(g, on);
      if (on) move(g, u.p);
    }
    for (const [id, g] of unitEls) if (!s.units[id]) show(g, false);
    for (const [a, g] of d.devs) {
      show(g, s.dev.includes(a));
      move(g, k.devBase(a), (k.inCab(a) ? 0.82 : 1) * phoneScale(c.z, stg));
      for (const sc2 of g.querySelectorAll('.scr')) show(sc2, sc2.getAttribute('data-s') === (s.screens[a] ?? 'idle'));
    }
    d.checkers.forEach((a, n) => {
      const g = sc.actors[a].gate,
        st = s.gates[a],
        rad = (st.deg * Math.PI) / 180;
      const b0 = P(g.px, g.y, g.z),
        e0 = P(g.px + g.L * Math.cos(rad), g.y, g.z + g.L * Math.sin(rad));
      for (const arm of [d.arms[n], d.arms2[n]]) {
        arm.setAttribute('x1', f1(b0[0]));
        arm.setAttribute('y1', f1(b0[1]));
        arm.setAttribute('x2', f1(e0[0]));
        arm.setAttribute('y2', f1(e0[1]));
      }
      d.arms[n].setAttribute('stroke', st.fail ? INK.fail : '#2e3440');
      d.gts[n].style.opacity = st.on === s.moment || st.fail ? '' : '0';
      d.hubs[n].setAttribute('cx', f1(b0[0]));
      d.hubs[n].setAttribute('cy', f1(b0[1]));
    });
    let a = '';
    for (const r of s.arcs) {
      const col = r.fail ? INK.fail : INK.data,
        dash = r.dashed ? ' stroke-dasharray="7 6"' : '';
      a += `<path d="${arcPart(r, 0, r.t)}" fill="none" stroke="${INK.data}" stroke-opacity="${s.summary ? (r.fail ? 0.38 : 0.38 * (s.fade ?? 0)) : r.moment === s.moment || r.hold ? 0.38 : 0.16}" stroke-width="2" stroke-linecap="round"${dash}/>`;
      if (r.t < 1)
        a += `<path d="${arcPart(r, Math.max(0, r.t - 0.16), r.t)}" fill="none" stroke="${col}" stroke-width="3.2" stroke-linecap="round"/>`;
      else if (r.fail) a += `<path d="${arcPart(r, 0.86, 1)}" fill="none" stroke="${INK.fail}" stroke-width="3.2" stroke-linecap="round"/>`;
      if (r.t > 0 && (r.t < 1 || r.hold))
        a += `<circle cx="${f1(bez(r, r.t)[0])}" cy="${f1(bez(r, r.t)[1])}" r="7" fill="${col}" stroke="#fff" stroke-width="2.4"/>`;
    }
    d.arcsG.innerHTML = a;
    sc.actors.forEach((_, i) => {
      q(`#pad-${i}`)?.classList.toggle('on', s.hi.includes(i) && !(i === sc.truck && out));
      q(`#b-${i}`)?.classList.toggle('quiet', !sc.stories[s.story].path.includes(i));
    });
  }

  function build(lay: Placed, story: Story) {
    const lead = document.createElementNS(NS, 'svg');
    let ls = '';
    tags = lay.tags.map((t) => {
      const e = el('div', `fw-tag${t.quiet ? ' fw-quiet' : ''}`),
        mk = el('i', 'fw-mk'),
        st = el('span', 'fw-ts');
      e.dataset.actor = t.name;
      st.append(mk, '');
      e.append(el('b', 'fw-tn', t.name), st);
      for (const c of t.cargo) {
        const row = el('span', 'fw-ts fw-cg');
        if (!c.fail) row.append(el('i', 'fw-mk', '✓'));
        row.append(c.thing);
        e.append(row);
      }
      put(e, t.r);
      if (story.acting[cur?.moment ?? -1] === t.name) e.setAttribute('aria-current', 'true');
      if (t.pin) {
        const { r } = t,
          [ax, ay] = t.anchor,
          px = t.pin === 'l' ? r.x : t.pin === 'r' ? r.x + r.w : Math.max(r.x + 9, Math.min(r.x + r.w - 9, ax)),
          py = t.pin === 't' ? r.y : t.pin === 'b' ? r.y + r.h : Math.max(r.y + 9, Math.min(r.y + r.h - 9, ay));
        ls += `<path d="M-6 0H6L0 8Z" transform="translate(${pt([px, py])}) rotate(${{ l: 90, t: 180, r: -90, b: 0 }[t.pin]})" fill="${OV}"/>`;
      } else
        ls += `<path d="M${pt(t.line[0])}L${pt(t.line[1])}" stroke="${OV}" stroke-opacity=".55"/><circle cx="${f1(t.line[1][0])}" cy="${f1(t.line[1][1])}" r="2.5" fill="${OV}"/>`;
      return { el: e, actor: t.actor, name: t.name, mk, st, end: t.end, w: e.style.width };
    });
    signs = lay.signs.map((g) => {
      const e = el('div', 'fw-sign');
      if (g.kick) e.append(el('div', 'fw-sk', sc.actors[g.actor].name));
      const rows = g.rows.map((r) => {
        const row = el('div', 'fw-row'),
          q = el('span', 'fw-q', r.q),
          a = el('span', r.a ? 'fw-a' : 'fw-a fw-m');
        row.append(q, a);
        e.append(row);
        return { q, a, m: !r.a };
      });
      put(e, g.r);
      ls += `<path d="M${pt(g.anchor)}L${pt(nearest(g.r, g.anchor))}" stroke="#2e3440" stroke-width="2"/>`;
      return { el: e, actor: g.actor, rows };
    });
    let n = 0;
    chips = lay.chips.map((c) => {
      const e = el('div', `fw-dchip${sc.things.has(c.text) ? ' fw-thing' : ''}`);
      if (c.mark) {
        e.append(el('i', 'fw-mk', c.mark));
        e.style.transitionDelay = `${n++ * 60}ms`;
      }
      e.append(c.text);
      put(e, c.r);
      return { el: e, text: c.text };
    });
    lead.innerHTML = ls;
    ov.replaceChildren(lead, ...tags.map((t) => t.el), ...signs.map((g) => g.el), ...chips.map((c) => c.el));
  }

  function sync(s: State, rest: boolean) {
    const story = sc.stories[s.story],
      acting = s.summary ? story.path : s.hi,
      fin = sc.boxes[story.end];
    const spoken = [];
    if (s.summary && fin) {
      spoken.push(`End: ${fin.label}${s.ever[fin.actor]?.fail ? ', failed' : ''}.`);
      const seen = new Set<string>();
      for (const u of Object.values(s.units))
        if (u.moment >= 0 && !seen.has(u.thing)) spoken.push(`${seen.add(u.thing) && u.thing}: ${u.fail ? 'stopped' : 'kept'}.`);
    }
    for (const t of tags) {
      const ev = s.ever[t.actor];
      if (ev && acting.includes(t.actor)) spoken.push(`${t.name}: ${named(ev, s.summary)}${ev.fail ? ', failed' : ''}.`);
    }
    svg.setAttribute('aria-label', spoken.join(' ') || said);
    for (const t of tags) {
      const ev = s.ever[t.actor];
      t.mk.hidden = !ev;
      same(t.mk, ev ? (ev.fail ? '✗' : '✓') : '');
      same(t.st.lastChild!, ev ? named(ev, s.summary) : 'Not reached');
      t.st.classList.toggle('fw-no', !!ev?.fail);
      t.el.classList.toggle('fw-end', s.summary && rest && t.end);
      t.el.style.width = rest ? t.w : 'max-content';
      t.el.style.minWidth = rest ? '' : t.w;
      t.el.classList.toggle('fw-x', !!ev?.fail);
    }
    for (const g of signs) {
      const gs = s.gates[g.actor];
      g.el.classList.toggle('fw-off', !rest && !(gs.rows.length && (gs.on === s.moment || s.summary)));
      g.rows.forEach((r, i) => {
        const row = gs.rows[i];
        (r.q.parentElement as HTMLElement).style.visibility = row ? '' : 'hidden';
        same(r.a, r.m && row?.a ? (row.fail ? '✗' : '✓') : (row?.a ?? ''));
        r.a.hidden = !row?.a;
        r.a.classList.toggle('fw-no', !!row?.fail);
      });
    }
    const live = new Set<string>();
    for (const a of s.arcs) if (a.moment === s.moment && a.t === 1 && a.text) live.add(a.text);
    for (const u of Object.values(s.units)) if (u.moment === s.moment && (u.where === 'yard' || u.where === 'gate')) live.add(u.thing);
    for (const c of chips) c.el.classList.toggle('fw-off', !rest && !live.has(c.text));
  }

  function frame(rest: boolean, t: number) {
    const { story, moment } = cur!;
    const lay = layoutFor(story, moment);
    const key = `${story}/${moment}/${stg.w}x${stg.h}`;
    if (built !== key) {
      built = key;
      build(lay, sc.stories[story]);
    }
    const s = stateAt(sc, story, moment, rest ? Infinity : t);
    draw(s, cam!);
    sync(s, rest);
  }

  const measure = () => {
    const { width: w, height: h } = stage.getBoundingClientRect();
    if (w === stg.w && h === stg.h) return false;
    stg = stageFor(w, h);
    lays.clear();
    use(get(stg.form));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return true;
  };
  const observer = new ResizeObserver(() => {
    if (!measure() || !cur || !stg.w) return;
    cancelAnimationFrame(raf);
    resized();
  });
  observer.observe(stage);
  measure();

  return {
    show(story, moment, motion, say) {
      cancelAnimationFrame(raf);
      said = say;
      cur = { story, moment };
      if (!stg.w || !stg.h) return 0;
      stg = stageOf(story);
      const to = layoutFor(story, moment).cam;
      const from = cam ?? to;
      if (!motion) {
        cam = to;
        frame(true, 0);
        return 0;
      }
      const { end, events } = timeline(sc, story, moment),
        c = events.find((e) => e.kind === 'camera')!;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = now - t0;
        if (t >= end) {
          cam = to;
          return frame(true, 0);
        }
        const e = ease.out(Math.min(1, Math.max(0, (t - c.start) / (c.end - c.start))));
        cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
        frame(false, t);
        raf = requestAnimationFrame(step);
      };
      step(t0);
      return end;
    },
    fits(story) {
      try {
        return !stg.w || viewFor(story).cams.every((p) => !p.faults);
      } catch {
        return false;
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
