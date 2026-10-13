import { cast, failed, hopsOf, isCheck, moments, question } from './explain.ts';
import { edgeId, isGroup, nodes, str } from './model.ts';
import type { FigLook, FlowProps } from './model.ts';
import { BAR_Y, BED_ROWS, C, GL, GZ, LANE, P, PHONE, S, TD, gateArt, street, truckArt } from './world-art.ts';
import type { Gate, Lot, Pt } from './world-art.ts';

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

  const depot = T >= 0 ? A[T].lot.depot! : { x: 0, y: 0 },
    YX = depot.x + 0.66,
    hulls = A.map((a) => a.lot.hull);
  const gateMid = (a: number) => {
    const g = A[a].gate;
    return P((g.px + g.ex) / 2, g.y, g.z);
  };
  const gateEnds = (a: number) => {
    const g = A[a].gate;
    return [P(g.ex, g.y, g.z - 0.05), P(g.ex, g.y)];
  };
  const inCab = (a: number) => a === T && !(s.truck!.orient === 'y' && s.truck!.ty + 2.5 <= depot.y + 0.01);
  const cabBase = (t: Truck) =>
    t.orient === 'y' ? P(YX + TD + 0.03, t.ty + 2.17, 0.58) : P(t.orient === 'R' ? t.x + 2.18 : t.x + 0.31, LANE + 0.41, 0.58);
  const devBase = (a: number) => (inCab(a) ? cabBase(s.truck!) : P(...A[a].port));
  const devTop = (a: number): Pt => {
    const b = devBase(a);
    return [b[0], b[1] - PHONE.h * (inCab(a) ? 0.82 : 1) - 4];
  };
  const bedAt = (t: Truck, i: number) =>
    P(t.x + sc.truckArt!.slots[t.orient === 'R' ? 'R' : 'L'][i % 4], BED_ROWS[Math.floor(i / 4)], 0.43);
  const truckRef = (t: Truck) => (t.orient === 'y' ? YX : t.orient === 'R' ? t.x + 2.18 : t.x + 0.31);
  const front = (t: Truck) => (t.orient === 'y' ? P(YX + TD / 2, t.ty + 2.5, 0.6) : P(t.orient === 'R' ? t.x + 2.5 : t.x, LANE, 0.6));
  const truckPts = (t: Truck): Pt[] => {
    const w =
      t.orient === 'y'
        ? [YX, YX + TD].flatMap((x) => [P(x, t.ty), P(x, t.ty + 2.5), P(x, t.ty, 0.9), P(x, t.ty + 2.5, 1.13)])
        : [t.x, t.x + 2.5].flatMap((x) => [LANE - 0.4, LANE + 0.4].flatMap((y) => [P(x, y), P(x, y, 1.13)]));
    if (s.dev.includes(T)) {
      const b = cabBase(t);
      w.push([b[0] - 11, b[1] - 40], [b[0] + 11, b[1] - 40]);
    }
    return w;
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
        Object.assign(row, { a: h.label.charAt(0).toUpperCase() + h.label.slice(1), fail: h.fail });
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
