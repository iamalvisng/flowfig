import { cast, failed, hopsOf, isCheck, moments, question } from './explain.ts';
import { edgeId, isGroup, nodes, str } from './model.ts';
import type { FigLook, FlowProps } from './model.ts';
import { HUD } from './looks.ts';
import { textWidth } from './text.ts';
import { BAR_Y, BED_ROWS, C, GL, GZ, LANE, P, PHONE, S, TD, gateArt, hull, street, truckArt } from './world-art.ts';
import type { Gate, Lot, Pt } from './world-art.ts';

export type { Pt };

export type Carry = { thing: string; form: 'box' | 'barrel' | 'notes'; count: number; from: number };
export type Hop = { edge: string; from: string; to: string; label: string; data: string; async: boolean; fail: boolean; carry?: Carry };
export type Box = { label: string; actor: number; dead: boolean; check: string };
export type Device = 'phone' | 'cab' | 'antenna';
export type SceneActor = { name: string; look?: FigLook; device: Device; lot: Lot; gate: Gate; port: Pt; checks: boolean };
export type Story = { name: string; moments: Hop[][]; acting: string[]; path: number[] };
export type Scene = {
  svg: string;
  actors: SceneActor[];
  boxes: Record<string, Box>;
  stories: Story[];
  truck: number;
  truckArt: ReturnType<typeof truckArt> | null;
  things: Map<string, { form: Carry['form']; count: number }>;
  keys: ('data' | 'thing' | 'check')[];
};

const FORMS: readonly Carry['form'][] = ['box', 'barrel', 'notes'];
const units = (n?: number) => Math.min(4, Math.max(1, Math.round(n ?? 1)));

export function scene(fig: FlowProps): Scene {
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
  const { svg: ground, lots } = street(
    cs.map((a) => a.look),
    devices.map((d) => d === 'antenna'),
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
    const prev = i > 0 ? Math.max(...xs(i - 1)) : left - 160;
    const sx = left - (device === 'phone' ? Math.min(98, (left - prev) * 0.62) : Math.min(44, (left - prev) * 0.28));
    const d = sx / C + BAR_Y;
    const y = 4.95;
    return {
      name: a.name,
      look: a.look,
      device,
      lot: lots[i],
      gate: { px: d - GL / 2, ex: d + GL / 2, y: BAR_Y, z: GZ, L: GL },
      port: [(left - 22) / C + y, y],
      checks: a.boxes.some((id) => isCheck(byId.get(id))),
    };
  });

  const boxes: Scene['boxes'] = {};
  cs.forEach((a, i) =>
    a.boxes.forEach((id) => {
      const n = byId.get(id);
      if (n) boxes[id] = { label: str(n.label), actor: i, dead: n.tone === 'red' || n.tone === 'gray', check: question(n) };
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
    return { name: label, moments: hops.length ? [...hops, []] : [], acting: moments(fig, label).map((m) => m.actor), path: [...path] };
  });

  const hopsAll = stories.flatMap((s) => s.moments.flat());
  const sides = (h: Hop) => [boxes[h.from]?.actor, boxes[h.to]?.actor];
  const keys: Scene['keys'] = [];
  if (hopsAll.some((h) => !h.carry && new Set(sides(h)).size === 2 && sides(h).every((a) => a !== undefined))) keys.push('data');
  if (hopsAll.some((h) => h.carry)) keys.push('thing');
  if (hopsAll.some((h) => isCheck(byId.get(h.from)))) keys.push('check');

  const art = truck >= 0 ? truckArt(lots[truck].depot!) : null;
  return {
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

export type Status = { label: string; fail: boolean };
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
export type Truck = { orient: 'y' | 'L' | 'R'; ty: number; x: number; door: number; load: string[] };
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
  screens: Record<number, 'idle' | 'in'>;
  frame: Pt[];
  lead?: Pt;
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
const yardSpot = (sc: Scene, a: number, k: number): Pt => [sc.actors[a].lot.x + 2.2 + (k % 2) * 0.42, 4.84 + Math.floor(k / 2) * 0.38];

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
function clears(r: Route, hulls: Pt[][], near: number[]) {
  for (let n = 0; n <= 160; n++) {
    const p = bez(r, n / 160);
    if (Math.hypot(p[0] - r.a[0], p[1] - r.a[1]) < 10 || Math.hypot(p[0] - r.b[0], p[1] - r.b[1]) < 10) continue;
    for (let i = 0; i < hulls.length; i++) {
      if (near.includes(i)) continue;
      const y = topAt(hulls[i], p[0]);
      if (inPoly(p, hulls[i]) || (p[1] < y && y - p[1] < CLEAR)) return false;
    }
  }
  return true;
}
function route(a: Pt, b: Pt, hulls: Pt[][], near: number[]): Route {
  for (let top = Math.min(a[1], b[1]) - 80; ; top -= 20) {
    const r: Route = { a, b, c1: [a[0], top], c2: [b[0], top] };
    if (top < -1200 || clears(r, hulls, near)) return r;
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
  if (depot) s.truck = { orient: 'y', ty: depot.y - 2.52, x: 0, door: 0, load: [] };
  sc.actors.forEach((_, a) => (s.gates[a] = { rows: [], deg: 0, fail: false, on: -1 }));
  const seen = new Set<string>();
  for (const h of sc.stories[story].moments.flat()) {
    const c = h.carry;
    const a = c && c.from >= 0 ? c.from : sc.boxes[h.from]?.actor;
    if (!c || seen.has(c.thing) || a === undefined) continue;
    seen.add(c.thing);
    for (let k = 0; k < c.count; k++) {
      const id = `${c.thing}/${k}`,
        bed = a === sc.truck && c.form !== 'notes' && s.truck;
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
  const parked = () => !s.truck || (s.truck.orient === 'y' && s.truck.ty + 2.5 <= depot.y + 0.01);
  const inCab = (a: number) => a === T && !parked();
  const cabBase = (t: Truck) =>
    t.orient === 'y' ? P(YX + TD + 0.03, t.ty + 2.17, 0.58) : P(t.orient === 'R' ? t.x + 2.18 : t.x + 0.31, LANE + 0.41, 0.58);
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
    truckPts: (t: Truck): Pt[] => {
      const w =
        t.orient === 'y'
          ? [YX, YX + TD].flatMap((x) => [P(x, t.ty), P(x, t.ty + 2.5), P(x, t.ty, 0.9), P(x, t.ty + 2.5, 1.13)])
          : [t.x, t.x + 2.5].flatMap((x) => [LANE - 0.4, LANE + 0.4].flatMap((y) => [P(x, y), P(x, y, 1.13)]));
      if (s.dev.includes(T)) {
        const b = cabBase(t);
        w.push([b[0] - 11, b[1] - 40], [b[0] + 11, b[1] - 40]);
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
  start.arcs = start.arcs.filter((a) => a.hold);
  start.frame = start.arcs.map((a) => a.b);
  start.summary = !hops.length && m === st.moments.length - 1;
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
    hulls = A.map((a) => a.lot.hull);
  const bedAt = (t: Truck, i: number) =>
    P(t.x + sc.truckArt!.slots[t.orient === 'R' ? 'R' : 'L'][i % 4], BED_ROWS[Math.floor(i / 4)], 0.43);
  const truckRef = (t: Truck) => (t.orient === 'y' ? YX : t.orient === 'R' ? t.x + 2.18 : t.x + 0.31);
  const front = (t: Truck) => (t.orient === 'y' ? P(YX + TD / 2, t.ty + 2.5, 0.6) : P(t.orient === 'R' ? t.x + 2.5 : t.x, LANE, 0.6));
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
    extra: Pick<Arc, 'gate' | 'hold' | 'fail' | 'text' | 'dashed'>,
    near: number[],
  ) => {
    const r = route(a, b, hulls, near),
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

  const drive = (i: number, at: number, x1: number, orient: 'L' | 'R') => {
    const t = s.truck!,
      head = (st: State) => front(st.truck!);
    s.frame.push(...truckPts(t));
    if (t.orient === 'y') {
      const y0 = t.ty;
      at = add('door', i, at, 500, (st, p) => void (st.truck!.door = p), ease.inOut, head);
      at = add(
        'drive',
        i,
        at,
        1000,
        (st, p) => {
          const tr = st.truck!;
          tr.ty = y0 + 3.05 * p;
          if (p === 1) Object.assign(tr, { orient, x: orient === 'R' ? YX - 1.78 : YX });
        },
        ease.inOut,
        head,
      );
    } else if (t.orient !== orient) {
      const x = t.x + (orient === 'R' ? -1.78 : 1.78);
      set(i, at, (st) => Object.assign(st.truck!, { orient, x }));
    }
    const x0 = t.x;
    s.frame.push(...truckPts({ ...t, x: x1 }));
    return add(
      'drive',
      i,
      at,
      Math.min(2200, 900 + Math.abs(x1 - x0) * 60),
      (st, p) => void (st.truck!.x = x0 + (x1 - x0) * p),
      ease.inOut,
      head,
    );
  };
  const driveTo = (i: number, at: number, a: number) => {
    const t = s.truck!,
      { x, door } = A[a].lot,
      goL = door < truckRef(t);
    if (t.orient !== 'y' && Math.abs(truckRef(t) - door) < 1.7) {
      s.frame.push(...truckPts(t));
      return at;
    }
    return drive(i, at, goL ? x + 0.95 : x + 0.2, goL ? 'L' : 'R');
  };

  const carry = (i: number, at: number, h: Hop, sa: number, ta: number) => {
    const ids = idsOf(h.carry!.thing),
      toGate = !!sc.boxes[h.to].check,
      where = toGate ? 'gate' : 'yard';
    if (!ids.length) return at;
    const dest = (k: number): Pt => (toGate ? [(A[ta].gate.px + A[ta].gate.ex) / 2 + 0.1 - k * 0.42, 6.45] : yardSpot(sc, ta, k));
    set(i, at, (st) => ids.forEach((id) => (st.units[id].moment = m)));
    if (toGate) set(i, at, (st) => void (st.gates[ta].on = m));
    const truck = h.carry!.form !== 'notes' && s.truck;
    if (truck && ta === T) {
      const t0 = driveTo(i, at, sa),
        base = truck.load.length;
      s.frame.push(...ids.map((id) => s.units[id].p));
      return Math.max(...ids.map((id, k) => hopUnit(i, t0 + 280 * k, id, ids, s.units[id].p, bedAt(s.truck!, base + k), 'bed', ta)));
    }
    if (truck && sa === T) {
      const t0 = driveTo(i, at, ta);
      return Math.max(
        ...ids.map((id, k) => hopUnit(i, t0 + 280 * k, id, ids, bedAt(s.truck!, s.truck!.load.indexOf(id)), P(...dest(k)), where, ta)),
      );
    }
    const paths = ids.map((id, k): Pt[] => {
      const [x, y] = s.units[id].p,
        ux = (x / C + y / S) / 2,
        uy = (y / S - x / C) / 2,
        [tx, ty] = dest(k);
      return [
        [ux, uy],
        [ux, 6.75],
        [tx, 6.75],
        [tx, ty],
      ];
    });
    paths.forEach((p) => s.frame.push(...p.map((q) => P(...q)), P(...p[3], 1.2)));
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
    const reach = (a: number, b: Box) => (st: State) => void (st.ever[a] = { label: b.label, fail: b.dead });
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
        at = add(
          'fail',
          i,
          at,
          120,
          (st) => {
            st.gates[fa].fail = true;
            st.arcs.forEach((x) => (x.fail ||= x.gate === fa && x.hold));
            for (const u of Object.values(st.units)) u.fail ||= u.where === 'gate' && u.at === fa;
            st.ever[fa] = { label: fb.label, fail: true };
          },
          linear,
        );
        at += 380 - 120;
        if (ta !== fa) {
          const near: number[] = [];
          at = pulse(
            'reply',
            i,
            at,
            gateMid(fa),
            endpoint(i, at, ta, h.to, near),
            { gate: -1, hold: false, fail: true, text: '', dashed: h.async },
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
          to = P(A[fa].lot.door, 4.75);
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
        gate = !!tb.check;
      if (gate) set(i, at, (st) => void (st.gates[ta].on = m));
      at = pulse(
        'pulse',
        i,
        at,
        from,
        to,
        { gate: gate ? ta : -1, hold: gate, fail: false, text: fb.check ? '' : h.data || h.label, dashed: h.async },
        near,
      );
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

  add('camera', -1, 0, CAM, () => {}, ease.out);
  const ends: number[] = [];
  hops.forEach((h, i) => {
    let dep = -1;
    for (let j = 0; j < i; j++) if (hops[j].to === h.from) dep = j;
    ends[i] = hop(i, dep >= 0 ? ends[dep] : CAM);
  });
  if (s.summary) {
    for (const a of st.path) s.frame.push(...A[a].lot.hull);
    if (s.truck && st.path.includes(T)) s.frame.push(...truckPts(s.truck));
    for (const u of Object.values(s.units)) if (['yard', 'gate'].includes(u.where)) s.frame.push(u.p, [u.p[0], u.p[1] + 40]);
    A.forEach((_, a) => s.gates[a].fail && s.frame.push(...gateEnds(a)));
  }
  return { steps, start, scratch: s, end: Math.max(CAM, ...ends) };
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
export type Stage = { w: number; h: number; narrow: boolean; region: { l: number; t: number; r: number; b: number } };
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
};
export type Sign = { actor: number; r: Rect; anchor: Pt; rows: { q: string; a: string; fail: boolean }[] };
export type Chip = { text: string; r: Rect; fail: boolean };
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
const GAP = 12,
  MARGIN = 48,
  TAG_H = 46,
  CHIP_H = 26;
const nearest = (r: Rect, p: Pt): Pt => [Math.max(r.x, Math.min(p[0], r.x + r.w)), Math.max(r.y, Math.min(p[1], r.y + r.h))];
function ring(p: Pt, w: number, h: number, ds: number[]): Opt[] {
  const out: Opt[] = [];
  const side = (c: number, size: number) => (c > 0.38 ? [0] : c < -0.38 ? [size] : [size / 2, size * 0.1, size * 0.9]);
  for (const d of ds)
    for (let i = 0; i < 16; i++) {
      const c = Math.cos((i * Math.PI) / 8),
        n = Math.sin((i * Math.PI) / 8);
      for (const sx of side(c, w)) for (const sy of side(n, h)) out.push({ x: p[0] + c * d - sx, y: p[1] + n * d - sy, w, h, anchor: p });
    }
  return out;
}
const bounds = (ps: Pt[]): Rect => {
  const xs = ps.map((p) => p[0]),
    ys = ps.map((p) => p[1]),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const width = (text: string, size: number, bold: boolean) => textWidth(text, size) * (bold ? 1.06 : 1);

export const hit = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export function polyHit(poly: Pt[], r: Rect, pad = 0): boolean {
  const R: Pt[] = [
    [r.x - pad, r.y - pad],
    [r.x + r.w + pad, r.y - pad],
    [r.x + r.w + pad, r.y + r.h + pad],
    [r.x - pad, r.y + r.h + pad],
  ];
  const axes: Pt[] = [
    [1, 0],
    [0, 1],
  ];
  poly.forEach((p, i) => {
    const o = poly[(i + 1) % poly.length];
    axes.push([o[1] - p[1], p[0] - o[0]]);
  });
  for (const [ax, ay] of axes) {
    const pa = poly.map((p) => p[0] * ax + p[1] * ay),
      pb = R.map((p) => p[0] * ax + p[1] * ay);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}

export function stageFor(w: number, h: number): Stage {
  const narrow = w < HUD.wide;
  return {
    w,
    h,
    narrow,
    region: narrow
      ? { l: 8, t: HUD.chips + 8, r: w - 8, b: h - HUD.sheet - 8 }
      : { l: HUD.pad * 2 + HUD.panel, t: HUD.chips + HUD.pad, r: w - HUD.pad, b: h - HUD.pad },
  };
}

function layout(sc: Scene, s: State, stage: Stage, cam: Cam) {
  const A = sc.actors,
    story = sc.stories[s.story],
    k = kit(sc, s),
    { l, t, r, b } = stage.region,
    cx = (l + r) / 2,
    cy = (t + b) / 2;
  const pr = (p: Pt): Pt => [(p[0] - cam.x) * cam.z + cx, (p[1] - cam.y) * cam.z + cy];
  const span = (ps: Pt[]) => bounds(ps.map(pr));
  const hulls = A.map((a) => a.lot.hull.map(pr));
  const truckW = s.truck && !k.parked() ? k.truckPts(s.truck) : null;
  const truck = truckW ? hull(truckW.map(pr)) : undefined;
  const gates = A.flatMap((a, i) => {
    const g = a.gate,
      st = s.gates[i];
    if (!a.checks || (st.on !== s.moment && !st.fail)) return [];
    const up = st.deg > 1 ? g.z + g.L : g.z + 0.3;
    return [{ actor: i, r: span([P(g.px - 0.35, g.y), P(g.ex + 0.12, g.y), P(g.px, g.y, up), P(g.ex, g.y, g.z)]) }];
  });
  const devices = s.dev
    .filter((a) => !k.inCab(a))
    .map((a) => {
      const p = k.devBase(a);
      return {
        actor: a,
        r: span([
          [p[0] - PHONE.w / 2, p[1] - PHONE.h],
          [p[0] + PHONE.w / 2, p[1]],
        ]),
      };
    });
  const arcs = s.arcs.filter((a) => a.t > 0).map((a) => Array.from({ length: 33 }, (_, i) => pr(bez(a, a.t * (0.05 + (0.9 * i) / 32)))));
  const taken: Rect[] = [...devices, ...gates].map((d) => d.r);
  let bad = 0;
  const inRegion = (o: Rect) => o.x >= l && o.y >= t && o.x + o.w <= r && o.y + o.h <= b;
  const solids = [...hulls, ...(truck ? [truck] : [])].map((h) => ({ h, box: bounds(h) }));
  const offB = (o: Rect) => !solids.some(({ h, box }) => hit(box, o, 2) && polyHit(h, o, 2));
  const offA = (o: Rect) => !arcs.some((arc) => arc.some(([x, y]) => x > o.x - 4 && x < o.x + o.w + 4 && y > o.y - 4 && y < o.y + o.h + 4));
  const free = (o: Rect) => !taken.some((x) => hit(x, o, 6));
  const clean = <T extends Rect>(opts: T[]) => opts.find((o) => inRegion(o) && free(o) && offA(o) && offB(o));
  const pick = <T extends Rect>(opts: T[]): T => {
    const o = clean(opts);
    if (o) return o;
    bad++;
    return opts.find((o) => inRegion(o) && free(o)) ?? opts[0];
  };

  const chips: Chip[] = [];
  const chip = (text: string, fail: boolean, opts: Pt[], w: number, around: Pt[]) => {
    for (const [px, py] of around)
      for (const d of [10, 30, 50])
        for (let i = 0; i < 8; i++) {
          const u = (i * Math.PI) / 4;
          opts.push([px + Math.cos(u) * (d + w / 2) - w / 2, py + Math.sin(u) * (d + CHIP_H / 2) - CHIP_H / 2]);
        }
    const rs = opts.map(([x, y]) => ({ x, y, w, h: CHIP_H }));
    const o = rs.find((o) => inRegion(o) && offB(o) && free(o));
    if (!o) bad++;
    chips.push({ text, fail, r: o ?? rs[0] });
    taken.push(o ?? rs[0]);
  };
  for (const a of s.arcs) {
    if (a.moment !== s.moment || a.t !== 1 || !a.text) continue;
    const w = 20 + width(a.text, 13, true),
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
      a.fail,
      opts,
      w,
      [0.5, 0.3, 0.7].map((u) => pr(bez(a, u))),
    );
  }
  const seen = new Set<string>();
  for (const u of Object.values(s.units)) {
    if ((u.moment !== s.moment && !s.summary) || u.moment < 0 || (u.where !== 'yard' && u.where !== 'gate') || seen.has(u.thing)) continue;
    seen.add(u.thing);
    const w = 20 + width(u.thing, 13, true),
      g = 10,
      h = CHIP_H,
      [px, py] = pr([u.p[0], u.p[1] + 6]);
    chip(
      u.thing,
      u.fail,
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
    );
  }

  const signs: Sign[] = [];
  for (const g of gates) {
    const gs = s.gates[g.actor];
    if (!gs.rows.length || !(gs.on === s.moment || (s.summary && gs.fail && !stage.narrow))) continue;
    const rows = gs.rows.map(({ q, a, fail }) => ({ q, a, fail }));
    const w = 22 + Math.max(...rows.map((x) => width(x.q, 15, true) + (x.a ? width(x.a, 13, true) + 40 : 0))),
      h = rows.length * 30 + (rows.length - 1) * 6 + 14;
    const gr = g.r,
      gate = A[g.actor].gate,
      foot = pr(P(gate.ex, gate.y)),
      bot = gr.y + gr.h,
      mid = gr.x + gr.w / 2,
      gy = gr.y + gr.h / 2;
    const opts: Opt[] = (
      [
        [foot[0] - 14, bot + GAP, foot],
        [foot[0] - w + 14, bot + GAP, foot],
        [mid - w / 2, bot + GAP, foot],
        [mid - 14, gr.y - GAP - h, [mid, gr.y]],
        [mid - w + 14, gr.y - GAP - h, [mid, gr.y]],
        [gr.x + gr.w + GAP, gy - h / 2, [gr.x + gr.w, gy]],
        [gr.x - GAP - w, gy - h / 2, [gr.x, gy]],
        [gr.x + gr.w + GAP, bot - h, [gr.x + gr.w, bot - 4]],
        [gr.x - GAP - w, bot - h, [gr.x, bot - 4]],
      ] as [number, number, Pt][]
    ).map(([x, y, anchor]) => ({ x, y, w, h, anchor }));
    for (const p of [foot, [mid, gr.y], [gr.x, gy], [gr.x + gr.w, gy]] as Pt[]) opts.push(...ring(p, w, h, [12, 24]));
    const o = pick(opts);
    signs.push({ actor: g.actor, r: { x: o.x, y: o.y, w, h }, anchor: o.anchor, rows });
    taken.push(o);
  }

  const tags: Tag[] = [];
  const rank = (a: number) => (s.hi.includes(a) ? 0 : story.path.includes(a) ? 1 : 2);
  const order = A.map((_, a) => a).sort((p, q) => rank(p) - rank(q));
  for (const a of order) {
    const ev = s.ever[a],
      name = A[a].name,
      status = ev ? ev.label : 'Not reached',
      mark: Mark = ev ? (ev.fail ? '✗' : '✓') : '',
      w = 20 + Math.max(width(name, 14.8, true), 18 + width(status, 13.8, false)),
      h = TAG_H,
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
    const ds = stage.narrow ? [12, 20, 30, 44, 58] : [12, 18, 24];
    opts.push(
      ...ring(anchor, w, h, ds),
      ...ring(
        hulls[a].reduce((m, p) => (p[1] > m[1] ? p : m)),
        w,
        h,
        ds,
      ),
    );
    const must = s.hi.includes(a) || (s.summary && story.path.includes(a));
    const base = { actor: a, name, status, mark, quiet: !story.path.includes(a) };
    const out = ax < l || ax > r || ay < t || ay > b;
    if (must && stage.narrow && out) {
      const tag = pin(base, w, h, [ax, ay]);
      tags.push(tag);
      taken.push(tag.r);
      continue;
    }
    const o = must ? pick(opts) : clean(opts);
    if (!o) continue;
    const tr = { x: o.x, y: o.y, w, h };
    tags.push({ ...base, r: tr, anchor: o.anchor, line: [nearest(tr, o.anchor), o.anchor] });
    taken.push(o);
  }

  function pin(base: Omit<Tag, 'r' | 'anchor' | 'line'>, w: number, h: number, [ax, ay]: Pt): Tag {
    const over = { l: l - ax, r: ax - r, t: t - ay, b: ay - b };
    const side = (Object.keys(over) as Tag['pin'][]).reduce((m, e) => (over[e!] > over[m!] ? e : m))!;
    const across = side === 'l' || side === 'r';
    const lo = across ? t : l,
      hi = across ? b - h : r - w,
      at = Math.max(lo, Math.min(hi, across ? ay - h / 2 : ax - w / 2));
    const opts: Opt[] = [];
    for (let d = 0; d <= hi - lo; d += 8)
      for (const v of d ? [at - d, at + d] : [at]) {
        if (v < lo || v > hi) continue;
        const x = across ? (side === 'l' ? l : r - w) : v,
          y = across ? v : side === 't' ? t : b - h;
        opts.push({ x, y, w, h, anchor: [ax, ay] });
      }
    const o = pick(opts);
    const tr = { x: o.x, y: o.y, w, h };
    return { ...base, r: tr, anchor: o.anchor, line: [nearest(tr, o.anchor), o.anchor], pin: side };
  }

  bad += devices.filter((d) => !inRegion(d.r) || !offB(d.r)).length;
  const placed: Placed = { cam, tags, signs, chips, devices, gates, hulls, truck, arcs, faults: bad };
  return { placed, bad, pts: s.frame.map(pr) };
}

export function place(sc: Scene, s: State, stage: Stage): Placed {
  const pts = s.frame.length ? s.frame : sc.actors.flatMap((a) => a.lot.hull);
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
  const fit = (c: Cam) => {
    const lay = layout(sc, { ...s, frame: pts }, stage, c);
    const rects = [...lay.placed.signs, ...lay.placed.tags, ...lay.placed.devices, ...lay.placed.chips].map((o) => o.r);
    const L = Math.min(...rects.map((o) => o.x), ...lay.pts.map((p) => p[0])),
      R = Math.max(...rects.map((o) => o.x + o.w), ...lay.pts.map((p) => p[0])),
      T = Math.min(...rects.map((o) => o.y), ...lay.pts.map((p) => p[1])),
      B = Math.max(...rects.map((o) => o.y + o.h), ...lay.pts.map((p) => p[1]));
    return { lay, L, R, T, B };
  };
  const search = (floor: number, top: number) => {
    let best: ReturnType<typeof layout> | null = null,
      last: ReturnType<typeof layout> | undefined;
    let z = Math.max(floor, Math.min((rw - 2 * pad) / (x1 - x0), (rh - 2 * pad) / (y1 - y0), top));
    for (let n = 0; n < 60 && z >= floor; n++, z *= 0.96) {
      let c: Cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
      for (let round = 0; round < 3; round++) {
        const f = fit(c);
        last = f.lay;
        if (round < 2) {
          c = { x: c.x + ((f.L + f.R) / 2 - (l + r) / 2) / z, y: c.y + ((f.T + f.B) / 2 - (t + b) / 2) / z, z };
          continue;
        }
        if (f.R - f.L <= rw - 2 * pad && f.B - f.T <= rh - 2 * pad) {
          if (!f.lay.bad) return { lay: f.lay, ok: true };
          if (!best || f.lay.bad < best.bad) best = f.lay;
        }
      }
    }
    return { lay: best ?? last!, ok: false };
  };
  const whole = search(stage.narrow ? ZMIN : 0, 1);
  if (whole.ok) return whole.lay.placed;
  const ref = stage.narrow ? ZMIN : whole.lay.placed.cam.z;
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const grid = (aim: { x: number; y: number }, zs: number[]) => {
    const cams = zs
      .flatMap((z) => SHIFT.flatMap((dy) => SHIFT.map((dx) => ({ z, dx, dy, base: Math.hypot(dx, dy) + Math.abs(z - ref) * 1000 }))))
      .sort((p, q) => p.base - q.base);
    let best: { lay: ReturnType<typeof layout>; score: number } | null = null;
    for (const { z, dx, dy, base } of cams) {
      if (best && base >= best.score) break;
      const lay = layout(sc, s, stage, { x: aim.x + dx / z, y: aim.y + dy / z, z });
      const score = base + lay.placed.tags.filter((t) => t.pin).length * 300;
      if (!lay.bad && (!best || score < best.score)) best = { lay, score };
    }
    return best?.lay;
  };
  const zs = [0, 1, 2, 3, 4, 5].map((i) => (stage.narrow ? ZMIN + i * 0.1 : ref * (1 - i * 0.08))),
    far = [0.4, 0.35, 0.3, 0.25].filter((z) => z < Math.min(...zs));
  return (grid(focus(sc, s) ?? mid, zs) ?? grid(mid, zs) ?? grid(mid, far) ?? whole.lay).placed;
}
const SHIFT = Array.from({ length: 13 }, (_, i) => (i - 6) * 40);

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
