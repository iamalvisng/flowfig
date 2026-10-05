import { STUB } from './model.ts';
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = 'l' | 'r' | 't' | 'b';
export type Pt = { x: number; y: number };
/** A cross-lane edge as two stubs, their pills and their points. */
export type Stub = { parts: [string, string]; pills: [Rect, Rect]; pts: [Pt[], Pt[]]; short?: true; tight: [boolean, boolean] };
/** `elbow` holds the corners of an elbow path for `check`. */
export type Routed = {
  id: string;
  d: string;
  mid: Pt;
  curve: [Pt, Pt, Pt, Pt];
  stub?: Stub;
  elbow?: Pt[];
  around?: Around;
  /** The px a detour and its label need outside the boxes on the `around` side. */
  room?: number;
};
/** A rect that a route keeps clear of. `box` marks a box. */
export type Avoid = Rect & { box?: boolean };
export const avoidOf = (boxes: Rect[], extra: Rect[], lanes: boolean): Avoid[] => [
  ...extra,
  ...boxes.map((r) => (lanes ? r : { ...r, box: true })),
];

type Around = 'above' | 'below' | 'left' | 'right';
type Pick = {
  id: string;
  a: Rect;
  b: Rect;
  sa: Side;
  sb: Side;
  from: string;
  to: string;
  around?: Around;
  arc?: number;
  elbow?: boolean;
  stub?: number[];
  bands?: [Rect | undefined, Rect | undefined];
  labelW?: number;
};

const LABEL_CLEAR = 4;
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;
const bezier = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};
const same = (r: Rect, q: Rect) => r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h;
const sideMid = (r: Rect, side: Side): Pt =>
  side === 'l'
    ? { x: r.x, y: cy(r) }
    : side === 'r'
      ? { x: r.x + r.w, y: cy(r) }
      : side === 't'
        ? { x: cx(r), y: r.y }
        : { x: cx(r), y: r.y + r.h };
const bend = (s: Pt, e: Pt, sa: Side): [Pt, Pt, Pt, Pt] => {
  const horiz = sa === 'l' || sa === 'r';
  const k = (horiz ? Math.abs(e.x - s.x) : Math.abs(e.y - s.y)) / 2;
  const sign = sa === 'r' || sa === 'b' ? 1 : -1;
  const c1 = horiz ? { x: s.x + sign * k, y: s.y } : { x: s.x, y: s.y + sign * k };
  const c2 = horiz ? { x: e.x - sign * k, y: e.y } : { x: e.x, y: e.y - sign * k };
  return [s, c1, c2, e];
};
const arcLine = (s: Pt, e: Pt, around: Around, at: number): [Pt, Pt, Pt, Pt] =>
  around === 'above' || around === 'below' ? [s, { x: s.x, y: at }, { x: e.x, y: at }, e] : [s, { x: at, y: s.y }, { x: at, y: e.y }, e];
const ARC = 50;
const ARC_STEP = 16;
const upright = (around: Around) => around === 'left' || around === 'right';
const arcAt = (a: Rect, b: Rect, around: Around, past: Rect[], labelW = 0) => {
  const rs = [a, b, ...past];
  // A cubic arc reaches 0.75 of its control offset at t = 0.5.
  const gap = upright(around) ? Math.max(ARC, (labelW / 2 + 12) / 0.75) : ARC;
  if (around === 'above') return Math.min(...rs.map((r) => r.y)) - gap;
  if (around === 'below') return Math.max(...rs.map((r) => r.y + r.h)) + gap;
  if (around === 'left') return Math.min(...rs.map((r) => r.x)) - gap;
  return Math.max(...rs.map((r) => r.x + r.w)) + gap;
};
const spanOf = (a: Rect, b: Rect, around: Around) => {
  const [p, q] = upright(around) ? [cy(a), cy(b)] : [cx(a), cx(b)];
  return [Math.min(p, q), Math.max(p, q)];
};
const SIDES: Record<Around, [Side, Side]> = { above: ['t', 't'], below: ['b', 'b'], left: ['l', 'l'], right: ['r', 'r'] };
const hit = (curve: [Pt, Pt, Pt, Pt], boxes: Rect[], m: number) => {
  const pts = Array.from({ length: 65 }, (_, i) => bezier(curve, i / 64));
  return boxes.filter((r) => pts.some((q) => q.x > r.x - m && q.x < r.x + r.w + m && q.y > r.y - m && q.y < r.y + r.h + m));
};

/** Routes edges between measured boxes as curved SVG paths. `elbow` draws right-angle paths; `stub` splits a cross-lane edge in two. */
export function route(
  edges: {
    id: string;
    from: string;
    to: string;
    around?: Around;
    sides?: [Side, Side];
    elbow?: boolean;
    stub?: number[];
    bands?: [Rect | undefined, Rect | undefined];
    labelW?: number;
  }[],
  rects: Record<string, Rect>,
  tips: Set<string> = new Set(),
  avoid: Avoid[] = [],
  area?: Rect,
  lanes?: { bands: Rect[]; boxes: Rect[] },
  pad = 24,
): Routed[] {
  const picks: Pick[] = [];
  const arcs: { way: Around; lo: number; hi: number; at: number }[] = [];
  for (const e of edges) {
    const a = rects[e.from],
      b = rects[e.to];
    if (!a || !b) continue;
    const stacked = a.x < b.x + b.w && b.x < a.x + a.w;
    const others = avoid.filter((r) => r.box && !same(r, a) && !same(r, b));
    const plain: [Side, Side] = stacked ? (a.y < b.y ? ['b', 't'] : ['t', 'b']) : a.x < b.x ? ['r', 'l'] : ['l', 'r'];
    const past = hit(bend(sideMid(a, plain[0]), sideMid(b, plain[1]), plain[0]), others, -2);
    const blocked = (way: Around, at: number) =>
      hit(arcLine(sideMid(a, SIDES[way][0]), sideMid(b, SIDES[way][1]), way, at), others, 2).length > 0;
    let around = e.around;
    let arc = around && arcAt(a, b, around, past, e.labelW);
    if (around && blocked(around, arc!)) arc = arcAt(a, b, around, past);
    if (!around && !e.sides && !e.stub && !e.elbow && past.length) {
      const ways = stacked ? (['left', 'right'] as const) : (['above', 'below'] as const);
      const tries: [Around, number][] = [];
      for (const share of [false, true])
        for (const way of ways) {
          const [lo, hi] = spanOf(a, b, way);
          const near = arcs.filter((q) => q.way === way && q.lo < hi && lo < q.hi).map((q) => q.at);
          if (near.length && !share) continue;
          const out = way === 'above' || way === 'left' ? -1 : 1;
          tries.push([way, out * Math.max(out * arcAt(a, b, way, past, e.labelW), ...near.map((n) => out * n + ARC_STEP))]);
        }
      for (const way of ways) tries.push([way, arcAt(a, b, way, past)]);
      [around, arc] = tries.find(([way, at]) => !blocked(way, at)) ?? [];
    }
    if (around) {
      const [lo, hi] = spanOf(a, b, around);
      arcs.push({ way: around, lo, hi, at: arc! });
    }
    const [sa, sb] = e.sides ?? (e.stub ? ['r', 'l'] : around ? SIDES[around] : plain);
    picks.push({ ...e, a, b, sa, sb, around, arc });
  }

  const ends = new Map<string, { pick: Pick; start: boolean }[]>();
  for (const pick of picks) {
    for (const start of [true, false]) {
      const key = (start ? pick.from : pick.to) + ':' + (start ? pick.sa : pick.sb);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key)!.push({ pick, start });
    }
  }
  const anchor = new Map<string, { x: number; y: number }>();
  for (const [key, list] of ends) {
    const tip = tips.has(key.slice(0, key.lastIndexOf(':')));
    const side = list[0].start ? list[0].pick.sa : list[0].pick.sb;
    const horiz = side === 't' || side === 'b';
    const other = (x: { pick: Pick; start: boolean }) => {
      const r = x.start ? x.pick.b : x.pick.a;
      return horiz ? cx(r) : cy(r);
    };
    list.sort((p, q) => other(p) - other(q));
    list.forEach((x, i) => {
      const r = x.start ? x.pick.a : x.pick.b;
      const f = tip ? 0.5 : (i + 1) / (list.length + 1);
      const pt =
        side === 'l'
          ? { x: r.x, y: r.y + r.h * f }
          : side === 'r'
            ? { x: r.x + r.w, y: r.y + r.h * f }
            : side === 't'
              ? { x: r.x + r.w * f, y: r.y }
              : { x: r.x + r.w * f, y: r.y + r.h };
      anchor.set(x.pick.id + (x.start ? ':s' : ':e'), pt);
    });
  }

  const drawn = (id: string, curve: [Pt, Pt, Pt, Pt], mid: Pt): Routed => {
    const [s, c1, c2, e] = curve;
    return { id, d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`, mid, curve };
  };
  const pills: Rect[] = [];
  const paths: Pt[] = [];
  const runs: [Pt, Pt][] = [];
  const track = (pts: Pt[]) => {
    paths.push(...pts);
    pts.slice(1).forEach((q, i) => runs.push([pts[i], q]));
  };
  const inBand = (r: Rect, b?: Rect) =>
    !b || (r.x >= b.x + 4 && r.x + r.w <= b.x + b.w - 4 && r.y >= b.y + 4 && r.y + r.h <= b.y + b.h - 4);
  const clear = (r: Rect, band?: Rect) =>
    inBand(r, band) &&
    (!area || (r.x >= area.x && r.x + r.w <= area.x + area.w && r.y >= area.y && r.y + r.h <= area.y + area.h)) &&
    ![...avoid, ...pills].some((q) => r.x < q.x + q.w + 2 && q.x < r.x + r.w + 2 && r.y < q.y + q.h + 2 && q.y < r.y + r.h + 2) &&
    !paths.some((q) => q.x > r.x - 2 && q.x < r.x + r.w + 2 && q.y > r.y - 2 && q.y < r.y + r.h + 2);
  const all = Object.values(rects);
  const [x0, y0] = [Math.min(...all.map((r) => r.x)), Math.min(...all.map((r) => r.y))];
  const [x1, y1] = [Math.max(...all.map((r) => r.x + r.w)), Math.max(...all.map((r) => r.y + r.h))];
  const outside = (way: Around, { x, y }: Pt) => (way === 'above' ? y0 - y : way === 'below' ? y - y1 : way === 'left' ? x0 - x : x - x1);
  const roomOf = (way: Around, at: number, curve: [Pt, Pt, Pt, Pt], labelW?: number) =>
    Math.max(
      ARC - 6,
      lanes || !labelW ? outside(way, { x: at, y: at }) - 6 : outside(way, bezier(curve, 0.5)) + (upright(way) ? labelW / 2 : 9),
    );
  const one = (p: Pick): Routed => {
    const s = anchor.get(p.id + ':s')!,
      e = anchor.get(p.id + ':e')!;
    if (p.stub) {
      const [ow, iw, sw] = p.stub;
      const [sb, tb] = p.bands ?? [];
      const rows = (box: Rect, y0: number, band?: Rect) => {
        const ys = band
          ? Array.from({ length: Math.max(0, Math.floor((band.h - 26) / 4)) + 1 }, (_, i) => band.y + 4 + i * 4)
          : [box.y + box.h + 2, box.y - 20];
        return [y0, ...ys.filter((y) => y !== y0)];
      };
      const place = (box: Rect, from: Pt, dir: 1 | -1, r: Rect, side: boolean, tip: boolean): [Rect, Pt, Pt] => {
        let a: Pt, b: Pt;
        if (side) [a, b] = [from, { x: dir > 0 ? r.x : r.x + r.w, y: r.y + 9 }];
        else {
          const x = tip ? cx(box) : Math.min(Math.max(r.x + r.w / 2, box.x + 8, r.x + 8), box.x + box.w - 8, r.x + r.w - 8);
          const under = r.y >= box.y + box.h;
          [a, b] = [
            { x, y: under ? box.y + box.h : box.y },
            { x, y: under ? r.y : r.y + r.h },
          ];
        }
        return dir > 0 ? [r, a, b] : [r, b, a];
      };
      function* beside(w: number, box: Rect, from: Pt, dir: 1 | -1, band?: Rect): Generator<[Rect, Pt, Pt]> {
        const tip = tips.has(dir > 0 ? p.from : p.to);
        const ys = rows(box, from.y - 9, band)
          .map((y, i) => ({ y, d: Math.abs(y + 9 - from.y), i }))
          .sort((m, q) => m.d - q.d || m.i - q.i);
        const heap: { dx: number; x: number; k: number; key: number; i: number }[] = [];
        for (let dx = STUB - 8 * Math.ceil((box.w + w) / 8); dx <= STUB + 240; dx += 8) {
          const x = dir > 0 ? from.x + dx : from.x - dx - w;
          if (dx < STUB && tip && !(x + 8 <= cx(box) && cx(box) <= x + w - 8)) continue;
          if (ys.length) heap.push({ dx, x, k: 0, key: Math.abs(dx - STUB) + ys[0].d, i: heap.length });
        }
        // Equal keys must keep the dx order, then the row order, or a pill moves.
        const less = (m: (typeof heap)[number], q: (typeof heap)[number]) => m.key < q.key || (m.key === q.key && m.i < q.i);
        heap.sort((m, q) => m.key - q.key || m.i - q.i);
        while (heap.length) {
          const h = heap[0];
          const { y } = ys[h.k++];
          if (h.k < ys.length) h.key = Math.abs(h.dx - STUB) + ys[h.k].d;
          else {
            const last = heap.pop()!;
            if (heap.length) heap[0] = last;
          }
          for (let i = 0; ;) {
            const l = 2 * i + 1;
            let m = i;
            if (l < heap.length && less(heap[l], heap[m])) m = l;
            if (l + 1 < heap.length && less(heap[l + 1], heap[m])) m = l + 1;
            if (m === i) break;
            [heap[i], heap[m]] = [heap[m], heap[i]];
            i = m;
          }
          if (h.dx < STUB && !(y >= box.y + box.h + STUB / 2 || y + 18 <= box.y - STUB / 2)) continue;
          yield place(box, from, dir, { x: h.x, y, w, h: 18 }, h.dx >= STUB, tip);
        }
      }
      const along = (w: number, box: Rect, from: Pt, dir: 1 | -1, band?: Rect): [Rect, Pt, Pt][] => {
        if (!tips.has(dir > 0 ? p.from : p.to)) return [];
        const out: [Rect, Pt, Pt, number][] = [];
        for (const y of rows(box, from.y + 12, band))
          for (let x = from.x - w + 8; x <= from.x - 8; x += 8) {
            const down = y >= from.y + 12;
            if (!down && y + 18 > from.y - 12) continue;
            const r = { x, y, w, h: 18 };
            const [a, b] = [from, { x: from.x, y: down ? y : y + 18 }];
            out.push([r, ...(dir > 0 ? [a, b] : [b, a]), Math.abs(y + 9 - from.y) + Math.abs(x + w / 2 - from.x)] as [
              Rect,
              Pt,
              Pt,
              number,
            ]);
          }
        return out.sort((m, q) => m[3] - q[3]).map(([r, a, b]) => [r, a, b]);
      };
      function* outs(w: number): Generator<[Rect, Pt, Pt]> {
        yield* beside(w, p.a, s, 1, sb);
        yield [
          { x: cx(p.a) - w / 2, y: p.a.y + p.a.h + STUB, w, h: 18 },
          { x: cx(p.a), y: p.a.y + p.a.h },
          { x: cx(p.a), y: p.a.y + p.a.h + STUB },
        ];
        yield [
          { x: cx(p.a) - w / 2, y: p.a.y - STUB - 18, w, h: 18 },
          { x: cx(p.a), y: p.a.y },
          { x: cx(p.a), y: p.a.y - STUB },
        ];
        yield* along(w, p.a, s, 1, sb);
      }
      function* ins(): Generator<[Rect, Pt, Pt]> {
        yield* beside(iw, p.b, e, -1, tb);
        yield [
          { x: cx(p.b) - iw / 2, y: p.b.y - STUB - 18, w: iw, h: 18 },
          { x: cx(p.b), y: p.b.y - STUB },
          { x: cx(p.b), y: p.b.y },
        ];
        yield [
          { x: cx(p.b) - iw / 2, y: p.b.y + p.b.h + STUB, w: iw, h: 18 },
          { x: cx(p.b), y: p.b.y + p.b.h + STUB },
          { x: cx(p.b), y: p.b.y + p.b.h },
        ];
        yield* along(iw, p.b, e, -1, tb);
      }
      const seg = (a: Pt, b: Pt) =>
        Array.from({ length: 9 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }));
      const free = (a: Pt, b: Pt, own: Rect) =>
        seg(a, b).every(
          (q) =>
            ![...avoid, ...pills].some((r) => r !== own && q.x > r.x + 2 && q.x < r.x + r.w - 2 && q.y > r.y + 2 && q.y < r.y + r.h - 2),
        );
      const whole = (a: Pt, b: Pt) => !runs.some(([c, d]) => crosses(a, b, c, d));
      const fits =
        (own: Rect, band: Rect | undefined, strict: boolean) =>
        ([r, a, b]: [Rect, Pt, Pt]) =>
          clear(r, band) && free(a, b, own) && (!strict || whole(a, b));
      const first = (own: Rect, band: Rect | undefined, lists: (() => Iterable<[Rect, Pt, Pt]>)[]) => {
        for (const strict of [true, false]) {
          const ok = fits(own, band, strict);
          for (const [i, list] of lists.entries()) for (const c of list()) if (ok(c)) return [c, i, !strict] as const;
        }
      };
      const hit = first(p.a, sb, [() => outs(ow), ...(sw == null ? [] : [() => outs(sw)])]);
      const cut = hit?.[1] === 1;
      const [po, o1, o2] = hit?.[0] ?? outs(ow).next().value!;
      pills.push(po);
      track(seg(o1, o2));
      const hit2 = first(p.b, tb, [ins]);
      const [pi, i1, i2] = hit2?.[0] ?? ins().next().value!;
      pills.push(pi);
      track(seg(i1, i2));
      const line = (a: Pt, b: Pt) => `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      const parts: [string, string] = [line(o1, o2), line(i1, i2)];
      return {
        id: p.id,
        d: parts.join(' '),
        mid: { x: po.x + po.w / 2, y: po.y + 9 },
        curve: [o1, o1, i2, i2],
        stub: {
          parts,
          pills: [po, pi],
          pts: [
            [o1, o2],
            [i1, i2],
          ],
          tight: [hit?.[2] !== false, hit2?.[2] !== false],
          ...(cut && { short: true as const }),
        },
      };
    }
    if (p.elbow) {
      if (e.x - s.x < 16 && s.y === e.y) {
        return { id: p.id, d: `M ${s.x} ${s.y} H ${e.x}`, mid: { x: (s.x + e.x) / 2, y: s.y }, curve: [s, s, e, e], elbow: [s, e] };
      }
      if (e.x - s.x < 16) {
        const mx = s.x + 8,
          ex = e.x - 8,
          my = (s.y + e.y) / 2;
        return {
          id: p.id,
          d: `M ${s.x} ${s.y} H ${mx} V ${my} H ${ex} V ${e.y} H ${e.x}`,
          mid: { x: (mx + ex) / 2, y: my },
          curve: [s, { x: mx, y: my }, { x: ex, y: my }, e],
          elbow: [s, { x: mx, y: s.y }, { x: mx, y: my }, { x: ex, y: my }, { x: ex, y: e.y }, e],
        };
      }
      const own = (r: Rect) => [p.a, p.b].some((q) => same(q, r));
      const all = avoid.filter((r) => !own(r));
      const boxes = all.filter((r) => r.box);
      const vClear = (x: number, ya: number, yb: number, m = 2) =>
        !all.some((r) => x > r.x - m && x < r.x + r.w + m && Math.max(ya, yb) > r.y && Math.min(ya, yb) < r.y + r.h);
      const hClear = (y: number, xa: number, xb: number, list: Rect[] = boxes, m = 2) =>
        !list.some((r) => y > r.y - m && y < r.y + r.h + m && Math.max(xa, xb) > r.x && Math.min(xa, xb) < r.x + r.w);
      const mid = (s.x + e.x) / 2;
      const gap = Array.from({ length: Math.floor((e.x - s.x - 16) / 4) + 1 }, (_, i) => s.x + 8 + i * 4).sort(
        (u, w) => Math.abs(u - mid) - Math.abs(w - mid),
      );
      const mx = [mid, e.x - 8, s.x + 8, ...gap].find((x) => vClear(x, s.y, e.y) && hClear(s.y, s.x, x) && hClear(e.y, x, e.x));
      if (mx == null && boxes.length) {
        const right = Math.max(...boxes.map((r) => r.x + r.w)) + 12;
        const left = Math.min(...boxes.map((r) => r.x));
        const [top, bottom] = [Math.min(...boxes.map((r) => r.y)) - 12, Math.max(...boxes.map((r) => r.y + r.h)) + 12];
        let best: { len: number; off: number; x: number; y: number; ex: number } | undefined;
        // ponytail: grid search in 4 px steps, about 10^5 tries on the roadmap.
        for (let x = s.x + 8; x <= right; x += 4) {
          if (!hClear(s.y, s.x, x)) continue;
          for (let ex = e.x - 8; ex >= left; ex -= 4) {
            if (!hClear(e.y, ex, e.x)) continue;
            for (let y = top; y <= bottom; y += 4) {
              const len = x - s.x + Math.abs(y - s.y) + Math.abs(x - ex) + Math.abs(e.y - y) + e.x - ex;
              const off = Math.abs(y - (s.y + e.y) / 2);
              if (best && (len > best.len || (len === best.len && off >= best.off))) continue;
              if (vClear(x, s.y, y, 8) && hClear(y, x, ex, all, 8) && vClear(ex, y, e.y)) best = { len, off, x, y, ex };
            }
          }
        }
        if (best) {
          const { x, y, ex } = best;
          return {
            id: p.id,
            d: `M ${s.x} ${s.y} H ${x} V ${y} H ${ex} V ${e.y} H ${e.x}`,
            mid: { x: (x + ex) / 2, y },
            curve: [s, { x, y }, { x: ex, y }, e],
            elbow: [s, { x, y: s.y }, { x, y }, { x: ex, y }, { x: ex, y: e.y }, e],
          };
        }
      }
      const x = mx ?? mid;
      const c1 = { x, y: s.y },
        c2 = { x, y: e.y };
      return {
        id: p.id,
        d: `M ${s.x} ${s.y} H ${x} V ${e.y} H ${e.x}`,
        mid: { x, y: (s.y + e.y) / 2 },
        curve: [s, c1, c2, e],
        elbow: [s, c1, c2, e],
      };
    }
    if (p.around) {
      const curve = arcLine(s, e, p.around, p.arc!);
      return { ...drawn(p.id, curve, bezier(curve, 0.5)), around: p.around, room: roomOf(p.around, p.arc!, curve, p.labelW) };
    }
    return drawn(p.id, bend(s, e, p.sa), { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 });
  };
  const done = new Map<Pick, Routed>();
  for (const p of picks) if (!p.stub) done.set(p, one(p));
  const routed = [...done.values()];
  const areaOf = (m: number) => {
    const side = (way: Around) => Math.max(m, ...routed.filter((r) => r.around === way).map((r) => r.room!));
    const [l, t] = [side('left'), side('above')];
    return { x: x0 - l, y: y0 - t, w: x1 - x0 + l + side('right'), h: y1 - y0 + t + side('below') };
  };
  const [fig, drawnArea] = [areaOf(Math.min(pad, PLAYER_PAD)), areaOf(pad)];
  const lineOf = (r: Routed) =>
    r.elbow
      ? r.elbow.slice(1).flatMap((q, k) => Array.from({ length: 17 }, (_, i) => lerp(r.elbow![k], q, i / 16)))
      : Array.from({ length: 33 }, (_, i) => bezier(r.curve, i / 32));
  const boxes = avoid.filter((q) => q.box);
  const pillAt = (at: Pt, w: number) => ({ x: at.x - w / 2, y: at.y - 9, w, h: 18 });
  const placeAll = (fresh: boolean) => {
    const out: Rect[] = [];
    const mids: Pt[] = [];
    let bad = 0;
    for (const [p, r] of done) {
      if (!p.labelW) continue;
      const at = lanes
        ? labelInBand(r, p.labelW, lanes, out)
        : fresh
          ? labelAlong(r, p.labelW, boxes, out, fig, routed.filter((o) => o !== r).flatMap(lineOf))
          : labelAlong(r, p.labelW, boxes, out);
      const pill = pillAt(at, p.labelW);
      if (!inside(pill, drawnArea) || [...boxes, ...out].some((q) => overlaps(pill, q, 1))) bad++;
      out.push(pill);
      mids.push(at);
    }
    return { out, mids, bad };
  };
  const fresh = placeAll(true);
  const old = fresh.bad && !lanes ? placeAll(false) : fresh;
  const use = old.bad < fresh.bad ? old : fresh;
  pills.push(...use.out);
  let k = 0;
  for (const [p, r] of done) {
    if (p.labelW) r.mid = use.mids[k++];
    track(Array.from({ length: 33 }, (_, i) => bezier(r.curve, i / 32)));
  }
  for (const p of picks) if (p.stub) done.set(p, one(p));
  return picks.map((p) => done.get(p)!);
}

export const arcRoom = (routed: Routed[], way: Around) => Math.max(0, ...routed.filter((r) => r.around === way).map((r) => r.room!));

// The player pads its root by 4 px on a side with no detour.
const PLAYER_PAD = 4;
const inside = (r: Rect, q: Rect) => r.x >= q.x - 0.5 && r.x + r.w <= q.x + q.w + 0.5 && r.y >= q.y - 0.5 && r.y + r.h <= q.y + q.h + 0.5;
const overlaps = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function labelAlong(r: Routed, w: number, boxes: Rect[], placed: Rect[], fig?: Rect, lines: Pt[] = []): Pt {
  const [p0, p1, p2, p3] = r.curve;
  const spots: Pt[] = [];
  for (const t of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]) {
    const u = 1 - t;
    const dx = 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x));
    const dy = 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y));
    const len = Math.hypot(dx, dy) || 1;
    const q = t === 0.5 ? r.mid : bezier(r.curve, t);
    for (const k of [0, 11, -11]) spots.push({ x: q.x - (dy / len) * k, y: q.y + (dx / len) * k });
  }
  const inFig = (at: Pt) => !fig || inside({ x: at.x - w / 2, y: at.y - 9, w, h: 18 }, fig);
  const clamp = (at: Pt) =>
    fig
      ? {
          x: Math.max(fig.x + w / 2, Math.min(at.x, fig.x + fig.w - w / 2)),
          y: Math.max(fig.y + 9, Math.min(at.y, fig.y + fig.h - 9)),
        }
      : at;
  const free = (at: Pt, strict: boolean) => {
    const pill = { x: at.x - w / 2, y: at.y - 9, w, h: 18 };
    return (
      inFig(at) &&
      !boxes.some((b) => overlaps(pill, b, 1)) &&
      !placed.some((b) => overlaps(pill, b, 1)) &&
      (!strict || !lines.some((q) => q.x > pill.x - 2 && q.x < pill.x + w + 2 && q.y > pill.y - 2 && q.y < pill.y + 20))
    );
  };
  for (const strict of [true, false]) for (const at of spots) if (free(at, strict)) return at;
  for (const at of spots.map(clamp)) if (free(at, false)) return at;
  return fig ? labelAlong(r, w, boxes, placed) : r.mid;
}

function labelInBand(r: Routed, w: number, { bands, boxes }: { bands: Rect[]; boxes: Rect[] }, pills: Rect[]): Pt {
  const ts = Array.from({ length: 65 }, (_, i) => i / 64).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
  const path = ts.map((t) => bezier(r.curve, t));
  const clear = (pill: Rect) => !boxes.some((b) => overlaps(pill, b, 1)) && !pills.some((b) => overlaps(pill, b, 1));
  const room = (x: number, b: Rect) => x - w / 2 >= b.x + LABEL_CLEAR && x + w / 2 <= b.x + b.w - LABEL_CLEAR;
  for (const q of path) {
    const pill = { x: q.x - w / 2, y: q.y - 9, w, h: 18 };
    const fits = bands.some((b) => room(q.x, b) && pill.y >= b.y + LABEL_CLEAR && pill.y + 18 <= b.y + b.h - LABEL_CLEAR);
    if (fits && clear(pill)) return q;
  }
  for (const q of path)
    for (const b of bands) {
      if (!room(q.x, b) || b.h < 18 + LABEL_CLEAR * 2) continue;
      const y = Math.min(Math.max(q.y, b.y + LABEL_CLEAR + 9), b.y + b.h - LABEL_CLEAR - 9);
      const pill = { x: q.x - w / 2, y: y - 9, w, h: 18 };
      if (clear(pill) && path.some((o) => o.x >= pill.x && o.x <= pill.x + w && o.y >= pill.y && o.y <= pill.y + 18)) return { x: q.x, y };
    }
  return r.mid;
}

/** True if segment a-b crosses c-d. The ends of a-b are trimmed by 1.5 px. */
export function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 4) return false;
  const t = 1.5 / len;
  const [p, q] = [
    { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    { x: b.x - (b.x - a.x) * t, y: b.y - (b.y - a.y) * t },
  ];
  const side = (o: Pt, u: Pt, v: Pt) => Math.sign((u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x));
  return side(p, q, c) * side(p, q, d) < 0 && side(c, d, p) * side(c, d, q) < 0;
}
