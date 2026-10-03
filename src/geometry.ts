import { STUB } from './model.ts';
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = 'l' | 'r' | 't' | 'b';
export type Pt = { x: number; y: number };
/** A cross-block edge of wrapped lanes: the two drawn stubs, their pills, and their points for `check`. `d` then holds both stubs,
 * so a packet runs the source stub and jumps to the target stub. */
export type Stub = { parts: [string, string]; pills: [Rect, Rect]; pts: [Pt[], Pt[]]; short?: true };
export type Routed = { id: string; d: string; mid: Pt; curve: [Pt, Pt, Pt, Pt]; stub?: Stub };

type Around = 'above' | 'below';
type Pick = {
  id: string;
  a: Rect;
  b: Rect;
  sa: Side;
  sb: Side;
  from: string;
  to: string;
  around?: Around;
  elbow?: boolean;
  stub?: number[];
  bands?: [Rect | undefined, Rect | undefined];
  labelW?: number;
};

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;
/** A point on the cubic Bézier at `t`, as `check` samples an edge. */
const bezier = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};

// Turns edges between measured boxes into curved SVG paths.
// Boxes stacked on top of each other connect bottom->top, otherwise side->side.
// Several edges leaving the same side of a box are spread out so they don't overlap,
// except on `tips` boxes (diamonds), where they all meet at the point.
// `elbow` draws a right-angle path, from a right end to a left end: its four curve points are the corners.
// `sides` fixes the two sides an edge uses (a timeline uses right to left).
// `around` makes an edge leave and enter from the top or bottom, arcing over whatever sits between.
// `bands` (with `stub`) are the lane bands of the source and of the target: each pill stays inside its band, 4 px clear of the border.
// `labelW` is the width of an edge's label pill: a stub pill keeps clear of it.
// `stub` (wrapped lanes: the source pill width, the target pill width, and the width of a shorter source pill) draws a short stub from the source to a pill, and from a second pill into the target.
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
  avoid: Rect[] = [], // what an elbow's vertical run and a stub pill must not cross (the timeline's outside labels; the boxes and gutters of lanes)
  area?: Rect, // where a stub pill may sit: the lanes right of the gutter
): Routed[] {
  const picks: Pick[] = [];
  for (const e of edges) {
    const a = rects[e.from],
      b = rects[e.to];
    if (!a || !b) continue;
    const stacked = a.x < b.x + b.w && b.x < a.x + a.w;
    const [sa, sb]: Side[] = e.sides
      ? e.sides
      : e.stub
        ? ['r', 'l']
        : e.around
          ? e.around === 'above'
            ? ['t', 't']
            : ['b', 'b']
          : stacked
            ? a.y < b.y
              ? ['b', 't']
              : ['t', 'b']
            : a.x < b.x
              ? ['r', 'l']
              : ['l', 'r'];
    picks.push({ ...e, a, b, sa, sb });
  }

  // For every (box, side), list the edge ends that sit there, sorted by where the other end is.
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
    list.sort((p, q) => other(p) - other(q)); // stable: ties keep declaration order
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

  // The four points travel with the path string: `flowfig check` samples the curve, and nothing has to parse `d`.
  const drawn = (id: string, curve: [Pt, Pt, Pt, Pt], mid: Pt): Routed => {
    const [s, c1, c2, e] = curve;
    return { id, d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`, mid, curve };
  };
  // Stub pills are placed after the other edges. Each pill keeps clear of `avoid`, of the edge labels, of the pills and stubs
  // before it, and of every edge path (sampled as `check` samples it).
  const pills: Rect[] = [];
  const paths: Pt[] = [];
  // The same samples as segments: a stub line must not cross one.
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
  const one = (p: Pick): Routed => {
    const s = anchor.get(p.id + ':s')!,
      e = anchor.get(p.id + ':e')!;
    if (p.stub) {
      // The source pill goes right of the source and the target pill left of the target, at the nearest clear place: it slides
      // away from the box in 8 px steps, and up or down inside the band in 4 px steps. The stub then runs on a slant. The last
      // places are below and above the box. A place is clear if the pill and its stub keep clear of everything, and the pill stays
      // inside its band. If no place is clear, the source pill tries its shorter text. If no place is clear then, the first place
      // stays and `check` reports it.
      const [ow, iw, sw] = p.stub;
      const [sb, tb] = p.bands ?? [];
      const rows = (box: Rect, y0: number, band?: Rect) => {
        const ys = band
          ? Array.from({ length: Math.max(0, Math.floor((band.h - 26) / 4)) + 1 }, (_, i) => band.y + 4 + i * 4)
          : [box.y + box.h + 2, box.y - 20];
        return [y0, ...ys.filter((y) => y !== y0)];
      };
      // A place and its stub. Beside the box, the stub runs from the box side to the near end of the pill. Under or over the box,
      // it runs straight down or up between the box and the pill. `dir` is 1 for the source (box to pill), -1 for the target.
      const place = (box: Rect, from: Pt, dir: 1 | -1, r: Rect, side: boolean, tip: boolean): [Rect, Pt, Pt] => {
        let a: Pt, b: Pt;
        if (side) [a, b] = [from, { x: dir > 0 ? r.x : r.x + r.w, y: r.y + 9 }];
        else {
          // A diamond has its point at the middle: the stub meets the point.
          const x = tip ? cx(box) : Math.min(Math.max(r.x + r.w / 2, box.x + 8, r.x + 8), box.x + box.w - 8, r.x + r.w - 8);
          const under = r.y >= box.y + box.h;
          [a, b] = [
            { x, y: under ? box.y + box.h : box.y },
            { x, y: under ? r.y : r.y + r.h },
          ];
        }
        return dir > 0 ? [r, a, b] : [r, b, a];
      };
      const beside = (w: number, box: Rect, from: Pt, dir: 1 | -1, band?: Rect): [Rect, Pt, Pt][] => {
        const tip = tips.has(dir > 0 ? p.from : p.to);
        const out: [Rect, Pt, Pt, number][] = [];
        for (let dx = STUB - 8 * Math.ceil((box.w + w) / 8); dx <= STUB + 240; dx += 8)
          for (const y of rows(box, from.y - 9, band)) {
            // Closer than STUB to the box side, a pill sits under or over the box, with room for the stub.
            const x = dir > 0 ? from.x + dx : from.x - dx - w;
            if (dx < STUB && !(y >= box.y + box.h + STUB / 2 || y + 18 <= box.y - STUB / 2)) continue;
            if (dx < STUB && tip && !(x + 8 <= cx(box) && cx(box) <= x + w - 8)) continue;
            out.push([...place(box, from, dir, { x, y, w, h: 18 }, dx >= STUB, tip), Math.abs(dx - STUB) + Math.abs(y + 9 - from.y)]);
          }
        return out.sort((m, q) => m[3] - q[3]).map(([r, a, b]) => [r, a, b]);
      };
      const outs = (w: number): [Rect, Pt, Pt][] => [
        ...beside(w, p.a, s, 1, sb),
        [
          { x: cx(p.a) - w / 2, y: p.a.y + p.a.h + STUB, w, h: 18 },
          { x: cx(p.a), y: p.a.y + p.a.h },
          { x: cx(p.a), y: p.a.y + p.a.h + STUB },
        ],
        [
          { x: cx(p.a) - w / 2, y: p.a.y - STUB - 18, w, h: 18 },
          { x: cx(p.a), y: p.a.y },
          { x: cx(p.a), y: p.a.y - STUB },
        ],
      ];
      const ins: [Rect, Pt, Pt][] = [
        ...beside(iw, p.b, e, -1, tb),
        [
          { x: cx(p.b) - iw / 2, y: p.b.y - STUB - 18, w: iw, h: 18 },
          { x: cx(p.b), y: p.b.y - STUB },
          { x: cx(p.b), y: p.b.y },
        ],
        [
          { x: cx(p.b) - iw / 2, y: p.b.y + p.b.h + STUB, w: iw, h: 18 },
          { x: cx(p.b), y: p.b.y + p.b.h + STUB },
          { x: cx(p.b), y: p.b.y + p.b.h },
        ],
      ];
      const seg = (a: Pt, b: Pt) =>
        Array.from({ length: 9 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }));
      // A stub must not run through a box other than its own, nor through a pill or a label, nor cross an edge path.
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
      // The first place whose stub crosses no edge path. If none, the first place that clears everything else: in a dense
      // figure no place may avoid every edge, and `check` then warns about the crossing.
      const first = (own: Rect, band: Rect | undefined, lists: [Rect, Pt, Pt][][]) =>
        [true, false].flatMap((strict) => lists.map((l, i) => [l.find(fits(own, band, strict)), i] as const)).find(([x]) => x);
      const hit = first(p.a, sb, [outs(ow), ...(sw == null ? [] : [outs(sw)])]);
      const cut = hit?.[1] === 1;
      const [po, o1, o2] = hit?.[0] ?? outs(ow)[0];
      pills.push(po);
      track(seg(o1, o2));
      const [pi, i1, i2] = first(p.b, tb, [ins])?.[0] ?? ins[0];
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
          ...(cut && { short: true as const }),
        },
      };
    }
    if (p.elbow) {
      // The vertical run sits at the midpoint x. Under 16 px of gap, it detours: out 8 px past the start, back to 8 px
      // before the end, then forward into the target. A gap of 0 px or less takes the same detour.
      // Over 16 px, it tries the midpoint, then 8 px before the end, then 8 px after the start, and takes the first that clears `avoid`.
      const y0 = Math.min(s.y, e.y),
        y1 = Math.max(s.y, e.y);
      const clear = (x: number) => !avoid.some((r) => x > r.x - 2 && x < r.x + r.w + 2 && y1 > r.y && y0 < r.y + r.h);
      const mx = e.x - s.x >= 16 ? ([(s.x + e.x) / 2, e.x - 8, s.x + 8].find(clear) ?? (s.x + e.x) / 2) : s.x + 8;
      const c1 = { x: mx, y: s.y },
        c2 = { x: mx, y: e.y };
      if (e.x - s.x < 16 && s.y === e.y) {
        // One row: a straight line, since a detour would only double back.
        return { id: p.id, d: `M ${s.x} ${s.y} H ${e.x}`, mid: { x: (s.x + e.x) / 2, y: s.y }, curve: [s, s, e, e] };
      }
      if (e.x - s.x < 16) {
        const ex = e.x - 8,
          my = (s.y + e.y) / 2;
        return {
          id: p.id,
          d: `M ${s.x} ${s.y} H ${mx} V ${my} H ${ex} V ${e.y} H ${e.x}`,
          mid: { x: (mx + ex) / 2, y: my },
          curve: [s, { x: mx, y: my }, { x: ex, y: my }, e],
        };
      }
      return { id: p.id, d: `M ${s.x} ${s.y} H ${mx} V ${e.y} H ${e.x}`, mid: { x: mx, y: (s.y + e.y) / 2 }, curve: [s, c1, c2, e] };
    }
    if (p.around) {
      // ponytail: arcs 50px past the two ends' boxes; a taller box in between can still be crossed.
      const y = p.around === 'above' ? Math.min(p.a.y, p.b.y) - 50 : Math.max(p.a.y + p.a.h, p.b.y + p.b.h) + 50;
      return drawn(p.id, [s, { x: s.x, y }, { x: e.x, y }, e], { x: (s.x + e.x) / 2, y: (s.y + 6 * y + e.y) / 8 });
    }
    const horiz = p.sa === 'l' || p.sa === 'r';
    const k = (horiz ? Math.abs(e.x - s.x) : Math.abs(e.y - s.y)) / 2;
    const sign = p.sa === 'r' || p.sa === 'b' ? 1 : -1;
    const c1 = horiz ? { x: s.x + sign * k, y: s.y } : { x: s.x, y: s.y + sign * k };
    const c2 = horiz ? { x: e.x - sign * k, y: e.y } : { x: e.x, y: e.y - sign * k };
    return drawn(p.id, [s, c1, c2, e], { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 });
  };
  const done = new Map<Pick, Routed>();
  for (const p of picks) {
    if (p.stub) continue;
    const r = one(p);
    done.set(p, r);
    if (p.labelW) pills.push({ x: r.mid.x - p.labelW / 2, y: r.mid.y - 9, w: p.labelW, h: 18 });
    track(Array.from({ length: 33 }, (_, i) => bezier(r.curve, i / 32)));
  }
  for (const p of picks) if (p.stub) done.set(p, one(p));
  return picks.map((p) => done.get(p)!);
}

/** True if the segment a-b crosses the segment c-d. The ends of a-b are trimmed by 1.5 px, so a touch at a box side does not count. */
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
