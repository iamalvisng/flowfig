import type { ReactNode } from 'react';
import { textWidth, wrap } from './text.ts';
import type { Rect } from './geometry.ts';

/** A box. A box with `show` in a step becomes a content card. */
export type FigNode = {
  /** Name that edges, steps and beats use for this box. Unique in the figure. */
  id: string;
  /** The title in the box. */
  label: ReactNode;
  /** A smaller line under the label. */
  sub?: ReactNode;
  /** `decision` is a diamond, `store` a cylinder for data at rest. Default: `box`. */
  shape?: 'box' | 'decision' | 'store';
  /** The least text lines a content card keeps. It still grows to fit. */
  lines?: number;
  /** Width in px. Overrides the width the layout picks. */
  width?: number;
  /** In `lanes`: the 0-based time column. Default: the first appearance in the steps. */
  at?: number;
  /** In `timeline`: the start date, or the milestone date, as YYYY-MM-DD. */
  from?: string;
  /** In `timeline`: the last day, as YYYY-MM-DD. No `to` makes a milestone. */
  to?: string;
  /** A permanent state color. An arriving hop with no tone uses it too. */
  tone?: FigTone;
  /** `start` draws a filled dot before the box, `end` a ringed dot after it. */
  mark?: 'start' | 'end';
  /** Code this draws: `path` or `path#symbol` from the repo root. Checked by `flowfig verify`. */
  source?: string;
  /** A figure with more detail: an SVG path from the repo root. */
  detail?: string;
};
/** A frame that lays out its children in a row or a column. */
export type FigGroup = {
  /** Name that edges can point at, to reach the group as a whole. */
  id?: string;
  /** The title on the frame. A labeled group is drawn as a frame. */
  label?: ReactNode;
  /** `row` puts the children side by side, `column` stacks them. Default: `row`. */
  direction?: 'row' | 'column';
  /** Space between children in px. Default: 28 for a column, fitted for a row. */
  gap?: number;
  /** Where children line up across the group's direction. Default: `center`, also for a column. */
  align?: 'start' | 'center' | 'end';
  /** The boxes and groups inside, in order. */
  children: (FigNode | FigGroup)[];
  /** On the root layout: flowfig places the boxes. A labeled group is a frame. */
  auto?: true;
};
/** An arrow from one box to another. */
export type FigEdge = {
  /** Name that steps and beats use to send a packet along this edge. Default: `from->to`. */
  id?: string;
  /** The `id` of the box where the edge starts. */
  from: string;
  /** The `id` of the box where the edge ends. */
  to: string;
  /** Text on the edge, drawn as a small pill. */
  label?: ReactNode;
  /** Routes the edge around the boxes in between (loops, skip-ahead edges). */
  around?: 'above' | 'below' | 'left' | 'right';
  /** Draws the edge only while a step uses it. */
  quiet?: boolean;
  /** Code this draws: `path` or `path#symbol` from the repo root. Checked by `flowfig verify`. */
  source?: string;
  /** The route, queue, topic or table that carries this edge. Checked by `flowfig verify`. */
  via?: string;
};
/** One packet on one edge. A string is the edge `id`. */
export type FigHop =
  | string
  | {
      /** The `id` of the edge the packet crosses. */
      edge: string;
      /** Runs the packet from the edge's `to` box to its `from` box. Default: `false`. */
      back?: boolean;
      /** A small card that rides along with the packet. */
      data?: ReactNode;
      /** Colors the packet, data card, edge and arrival box for this beat. Default: the accent. */
      tone?: FigTone;
      /** Marks a message that needs no reply. The rail draws it dashed. Default: `false`. */
      async?: boolean;
      /** Code this draws: `path` or `path#symbol` from the repo root. Checked by `flowfig verify`. */
      source?: string;
      /** The route, queue, topic or table that carries this edge. Checked by `flowfig verify`. */
      via?: string;
    };
/** One moment of a step. No edges means a pause. */
export type FigBeat = {
  /** The packets that cross in this beat. An array runs them at the same time. */
  edges?: FigHop | FigHop[];
  /** The line of narration for this beat. */
  say?: ReactNode;
  /** Fills the content card of each named box until the step ends. */
  show?: Record<string, FigContent>;
  /** Ids of boxes to highlight for this beat, without a packet or a content card. */
  light?: string[];
  /** Ids of boxes that take the active look in this beat. */
  focus?: string[];
  /** Beat length in ms. Default: `speed` plus the time to read `say`. */
  ms?: number;
};
/** One line of a content card. */
export type FigRow = {
  /** A short colored label at the start of the line. */
  tag?: string;
  /** The color of the tag. Default: `blue`. */
  tone?: FigTone;
  /** The main text of the line. */
  text: ReactNode;
  /** Muted text after the main text. */
  meta?: ReactNode;
  /** A mark at the right end of the line, such as a check or "new". */
  mark?: ReactNode;
  /** Draws the text in a monospace font. Default: `false`. */
  mono?: boolean;
};
/** The color of a row tag, a hop or a box. */
export type FigTone = 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'gray';
/** What a content card shows: rows, or anything React can render. */
export type FigContent = FigRow[] | ReactNode;
/** One story the figure can tell. The player shows one tab for each step. */
export type FigStep = {
  /** The tab title. */
  label: ReactNode;
  /** The line shown under the figure while no beat of the step has a `say`. */
  caption?: ReactNode;
  /** The beats in play order. A bare hop or hop array is one beat. */
  flow: (FigHop | FigHop[] | FigBeat)[];
  /** Ids of boxes to highlight for the whole step. */
  nodes?: string[];
};
/** Colors for the figure. A key you leave out keeps the built-in color. */
export type FigTheme = Partial<Record<'accent' | 'fg' | 'muted' | 'bg' | 'surface' | 'border' | 'font', string>>;
/** The spec of one figure. Give it to `Flow` (React) or to `toSvg` (SVG string). */
export type FlowProps = {
  /** The boxes and how they line up. */
  layout: FigGroup;
  /** The arrows between the boxes. */
  edges: FigEdge[];
  /** The stories the figure tells. With no steps, the figure is a still map. */
  steps?: FigStep[];
  /** Colors. CSS `--fig-accent`, `--fig-bg` on `.flowfig` also set them. `font` defaults to `inherit`. */
  theme?: FigTheme;
  /** Milliseconds a packet takes to cross one edge. Default: 900. */
  speed?: number;
  /** Starts playing when the figure mounts. Default: `true`. Only the React player reads it. */
  autoplay?: boolean;
  /** Dev aid: run the `flowfig check` rules on the drawn figure, then console.warn faults. */
  check?: boolean;
  /** Draws the steps as a lifeline rail under the map. `'only'` draws no map. */
  rail?: boolean | 'only';
  /** Draws the layout as swimlanes: a `column` group of labeled groups, one per role. */
  lanes?: true;
  /** Draws a timeline: one labeled group per track, boxes placed by `from` and `to`. */
  timeline?: true;
  /** In `timeline`: the date of the today marker, as YYYY-MM-DD. */
  today?: string;
};
/** A figure file's default export: a title, a source note and the props. */
export type Figure = { title: string; source?: string; props: FlowProps };

/** A beat with every hop spelled out: an edge id and a direction. */
export type Beat = Omit<FigBeat, 'edges'> & {
  hops: { edge: string; back: boolean; data?: ReactNode; tone?: FigTone; async?: boolean; source?: string; via?: string }[];
};
export const toBeat = (b: FigHop | FigHop[] | FigBeat): Beat => {
  const isBeat = typeof b === 'object' && !Array.isArray(b) && !('edge' in b);
  const { edges, ...rest }: FigBeat = isBeat ? b : { edges: b };
  const hops = edges == null ? [] : Array.isArray(edges) ? edges : [edges];
  return {
    ...rest,
    hops: hops.map((h) => (typeof h === 'string' ? { edge: h, back: false } : { back: false, ...h })),
  };
};

export const edgeTip = (id: string, source: string | undefined, beats: Beat[]): string | undefined => {
  const all = new Set(source ? [source] : []);
  for (const b of beats) for (const h of b.hops) if (h.edge === id && h.source) all.add(h.source);
  return all.size ? [...all].join('\n') : undefined;
};
// A React node can be an object, so test for the `text` key.
export const isRows = (c: FigContent): c is FigRow[] =>
  Array.isArray(c) && c.every((r) => r != null && typeof r === 'object' && 'text' in r);

export const edgeId = (e: FigEdge) => e.id ?? `${e.from}->${e.to}`;
export const isGroup = (x: FigNode | FigGroup): x is FigGroup => 'children' in x;
export const decisions = (g: FigGroup): string[] =>
  g.children.flatMap((c) => (isGroup(c) ? decisions(c) : c.shape === 'decision' ? [c.id] : []));

export const CARD_WIDTH = 166;
export const BASE_RATE = 1.25;
export const CARD_LINE = 15,
  CARD_PAD = 6;
export const TONES: Record<FigTone, string> = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  green: '#10b981',
  orange: '#f59e0b',
  red: '#ef4444',
  gray: '#8b949e',
};
export const toneFill = (c: string) => `color-mix(in srgb, ${c} 64%, #000)`;
export const toneTint = (c: string, bg: string, pct = 8) => `color-mix(in srgb, ${c} ${pct}%, ${bg})`;
export const labelPillW = (label: string) => textWidth(label, 11, true) + 14;
export const ASYNC_TAG_W = textWidth('ASYNC', 9) + 8;
export const EDGE_ON = 2,
  EDGE_OFF = 1.25;

export const LIGHT = { accent: '#0074d9', fg: '#1c1e21', muted: '#606770', bg: '#ffffff', surface: '#f5f7fa', border: '#d0d7de' };
// White text on the dark accent needs 4.5:1 contrast.
export const DARK = { accent: '#1f78c8', fg: '#e3e3e3', muted: '#9aa0a6', bg: '#1b1b1d', surface: '#242526', border: '#3a3b3c' };
export const ON_ACCENT = '#ffffff';

// A React element has no string form, so only text survives.
export const str = (n: unknown): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '');
export const readMs = (say: unknown): number => {
  const w = str(say).split(/\s+/).filter(Boolean).length;
  return w ? 400 + 240 * w : 0;
};
export const beatMs = (b: Beat, speed: number): number => b.ms ?? speed + readMs(b.say);
export const playheadItem = <T extends { id: string }>(items: T[], beats: { focus?: string[] }[], i: number): T | undefined => {
  for (let k = Math.min(i, beats.length - 1); k >= 0; k--) {
    const id = (beats[k].focus ?? []).find((f) => items.some((x) => x.id === f));
    if (id != null) return items.find((x) => x.id === id);
  }
  return undefined;
};
export const loopStartItem = <T extends { id: string }>(items: T[], steps: { flow: FigStep['flow'] }[]): T | undefined =>
  playheadItem(items, (steps[0]?.flow ?? []).slice(0, 1).map(toBeat), 0);

export const outsideLabelRect = (bar: { x: number; y: number; w: number; h: number }, label: string) => ({
  x: bar.x + bar.w + 6,
  y: bar.y,
  w: textWidth(label, 13),
  h: bar.h,
});

export const labelSpan = (t0: number, end: number, ramp: number): [number, number] => [Math.min(t0 + ramp, end), end];

export const dateLabelRaised = (x: number, today: number | null | undefined, w: number, todayW: number): boolean =>
  today != null && x + 3 < today - 3 && x + 3 + w > today - 3 - todayW;

export const STEP_HOLD_MS = 2000;
export const nodes = (g: FigGroup): FigNode[] => g.children.flatMap((c) => (isGroup(c) ? nodes(c) : [c]));
export const LANE_GAP = 56,
  LANE_PAD = 24,
  LANE_ROW_GAP = 20;

export const isLanesLayout = (g: FigGroup): boolean =>
  g.direction === 'column' && g.children.every((c) => isGroup(c) && c.label != null && c.children.every((k) => !isGroup(k)));

export const validAt = (at: unknown): at is number => typeof at === 'number' && Number.isInteger(at) && at >= 0;

/** The time column of each box: first use in the steps, then layout order. `at` wins. */
export function laneColumns(fig: FlowProps): Map<string, number> {
  const byId = new Map(fig.edges.map((e) => [edgeId(e), e]));
  const cols = new Map<string, number>();
  const seen = (id: string) => {
    if (!cols.has(id)) cols.set(id, cols.size);
  };
  for (const s of fig.steps ?? [])
    for (const b of s.flow.map(toBeat))
      for (const h of b.hops) {
        const e = byId.get(h.edge);
        if (!e) continue;
        for (const id of h.back ? [e.to, e.from] : [e.from, e.to]) seen(id);
      }
  for (const n of nodes(fig.layout)) seen(n.id);
  for (const n of nodes(fig.layout)) if (validAt(n.at)) cols.set(n.id, n.at);
  return cols;
}

export const LABEL_LINE = 18;
export const FRAME_SIDE = 18,
  NODE_MIN_W = 100,
  NODE_MAX_W = 190;
export const LANE_BLOCK_GAP = 40;
export const STUB = 12,
  STUB_CLEAR = 8,
  STUB_ROOM = 30;

/** The width of a box as the SVG draws it, before a diamond adds its 70 px. */
export function nodeWidth(item: FigNode, carded: boolean, cap = NODE_MAX_W): number {
  if (item.width != null) return item.width;
  if (carded) return CARD_WIDTH;
  const label = textWidth(str(item.label), 14) + 32;
  const sub = textWidth(str(item.sub), 12) + 32;
  return Math.min(item.shape === 'decision' ? NODE_MAX_W : cap, Math.max(NODE_MIN_W, label, sub));
}

export function labelLines(item: FigNode, w: number): string[] {
  const label = str(item.label);
  if (item.shape === 'decision' || textWidth(label, 14) <= w - 32 + 0.5) return [label];
  const lines = wrap(label, w - 32, 14);
  return lines.length === 2 && lines.every((l) => textWidth(l, 14) <= w - 32) ? lines : [label];
}

export function itemWidth(item: FigNode | FigGroup, carded: { has(id: string): boolean }, edges: FigEdge[], cap = NODE_MAX_W): number {
  if (!isGroup(item)) return nodeWidth(item, carded.has(item.id), cap) + (item.shape === 'decision' ? 70 : 0);
  const ws = item.children.map((c) => itemWidth(c, carded, edges, cap));
  const inner = item.direction === 'column' ? Math.max(...ws) : ws.reduce((a, b) => a + b, 0) + groupGap(item, edges) * (ws.length - 1);
  return inner + (item.label != null ? FRAME_SIDE * 2 : 0);
}

export function fitCap(fig: FlowProps, width: number, padding = 24): number {
  if ((fig.lanes || fig.timeline) && isLanesLayout(fig.layout)) return NODE_MAX_W;
  const carded = new Set((fig.steps ?? []).flatMap((s) => s.flow.flatMap((b) => Object.keys(toBeat(b).show ?? {}))));
  const fits = (n: FigNode, cap: number) => {
    const w = nodeWidth(n, carded.has(n.id), cap);
    return Math.max(textWidth(str(n.sub), 12), ...labelLines(n, w).map((l) => textWidth(l, 14))) + 32 <= w + 0.5;
  };
  const keep = nodes(fig.layout).filter((n) => fits(n, NODE_MAX_W));
  let cap = NODE_MAX_W;
  while (cap > 110 && itemWidth(fig.layout, carded, fig.edges, cap) + padding * 2 > width && keep.every((n) => fits(n, cap - 20)))
    cap -= 20;
  return cap;
}

export const diamondRoom = (w: number, h: number, far: number) => w * Math.max(0, 1 - far / (h / 2)) - 8;
/** The lines of a diamond with no card. The diamond grows 15 px for each sub line that wraps. */
export function diamondLines(
  item: FigNode,
  w: number,
): { h: number; label: { dy: number; far: number }; subs: { text: string; dy: number; far: number }[] } {
  const sub = item.sub ? str(item.sub) : '';
  for (let n = sub ? 1 : 0; ; n++) {
    const h = 62 + 15 * n;
    const dy0 = n ? -2 - 7.5 * (n - 1) : 5;
    const at = (dy: number, size: number) => Math.max(Math.abs(dy - 0.75 * size), dy + 0.25 * size);
    const last = n ? at(dy0 + 15 * n, 12) : 0;
    const lines = n ? wrap(sub, diamondRoom(w, h, last), 12) : [];
    if (lines.length <= n || n >= 6)
      return {
        h,
        label: { dy: dy0, far: at(dy0, 14) },
        subs: lines.map((text, k) => ({ text, dy: dy0 + 15 * (k + 1), far: at(dy0 + 15 * (k + 1), 12) })),
      };
  }
}

/** The lane copies whose stub end has no clear place. The renderer grows each by STUB_ROOM. */
export function tightCopies(
  lanes: FigGroup[],
  ends: Map<string, [number, number]>,
  edges: FlowProps['edges'],
  routed: { id: string; stub?: { tight: [boolean, boolean] } }[],
): Set<string> {
  const laneOf = (id: string) => lanes.findIndex((l) => l.id === id || l.children.some((b) => (b as FigNode).id === id));
  const out = new Set<string>();
  for (const r of routed) {
    const e = edges.find((x) => edgeId(x) === r.id);
    const [fb, tb] = ends.get(r.id) ?? [];
    if (!e || !r.stub) continue;
    if (r.stub.tight[0] && fb != null) out.add(`${laneOf(e.from)}@${fb}`);
    if (r.stub.tight[1] && tb != null) out.add(`${laneOf(e.to)}@${tb}`);
  }
  return out;
}

export const laneGutter = (lanes: FigGroup[]) =>
  Math.max(0, ...lanes.map((l) => textWidth(str(l.label).toUpperCase(), 12))) + FRAME_SIDE * 2;

/** How a lanes figure wraps. Both renderers lay out with it. */
export type LanePlan = {
  /** The time column of each box. */
  cols: Map<string, number>;
  /** The first column of each block, then the column count. */
  starts: number[];
  /** The most columns in one block. */
  per: number;
  /** The blocks that hold a box, in order. An empty figure keeps block 0. */
  blocks: number[];
  /** The width of the label gutter, the same in every block. */
  gutter: number;
  /** The space after each column: the gap to the next, or the band margin. */
  gaps: number[];
  /** The room before the first column of each block, after the gutter. */
  lead: number[];
  /** The block of each edge source and target, by edge id. */
  ends: Map<string, [number, number]>;
  /** The pill texts of an edge across two blocks: source, target, then a short source. */
  stubs: Map<string, string[]>;
  /** Same-lane, same-block edges with a box between them and no `around`. They route below. */
  around: Set<string>;
  /** The lane copies (`laneIndex@block`) that grow by STUB_ROOM: a stub pill has no room. */
  tall: Set<string>;
  /** Edges with a lane end in no block on the other side. `check` reports them. */
  lost: string[];
};

export const laneBlock = (starts: number[], c: number): number => {
  let k = 0;
  while (k < starts.length - 2 && c >= starts[k + 1]) k++;
  return k;
};

export const stubTexts = (label: unknown, from: unknown, to: unknown): string[] => [
  `${str(label) ? str(label) + ' ' : ''}→ ${str(to)}`,
  `from ${str(from)}`,
  ...(str(label) ? [`→ ${str(to)}`] : []),
];

/**
 * The wrap of a lanes figure: it wraps like text when the time columns do not fit `width`.
 * The block count depends on the boxes only, not on pills.
 */
export function lanePlan(fig: FlowProps, { width = 830, minText = 10, padding = 24, floor = 0 } = {}): LanePlan {
  const cols = laneColumns(fig);
  const n = Math.max(-1, ...cols.values()) + 1;
  const shown = (fig.steps ?? []).flatMap((s) => s.flow.flatMap((b) => Object.entries(toBeat(b).show ?? {})));
  const carded = new Set(shown.map(([id]) => id));
  const mono = shown.some(([, c]) => isRows(c) && c.some((r) => r.mono));
  const colW = Array.from({ length: n }, () => 0);
  const byId = new Map(nodes(fig.layout).map((b) => [b.id, b]));
  for (const b of byId.values()) {
    const c = cols.get(b.id)!;
    colW[c] = Math.max(colW[c], nodeWidth(b, carded.has(b.id)) + (b.shape === 'decision' ? 70 : 0));
  }
  const font = mono ? 10.5 : 11;
  const limit = (width * font) / minText;
  const room = limit - padding * 2;
  const lanes = fig.layout.children as FigGroup[];
  const laneOf = new Map(lanes.filter((l) => l.id != null).map((l) => [l.id!, l]));
  const gutter = laneGutter(lanes);
  const plan = (count: number): readonly [LanePlan, boolean] => {
    const starts = [0];
    for (let k = 0; k < count; k++) starts.push(starts[k] + Math.floor(n / count) + (k < n % count ? 1 : 0));
    const colBlock = (c: number) => laneBlock(starts, c);
    const blockOf = (id: string) => colBlock(cols.get(id)!);
    const held = [...new Set([...byId.keys()].map(blockOf))].sort((a, b) => a - b);
    const blocks = held.length ? held : [0];
    const wrapped = blocks.length > 1;
    const showing = (l: FigGroup) =>
      wrapped ? [...new Set((l.children as FigNode[]).map((b) => blockOf(b.id)))].sort((a, b) => a - b) : blocks;
    const stubs = new Map<string, string[]>();
    const ends = new Map<string, [number, number]>();
    const lost: string[] = [];
    fig.edges.forEach((e) => {
      const id = edgeId(e);
      const [fl, tl] = [laneOf.get(e.from), laneOf.get(e.to)];
      if (!(byId.has(e.from) || fl) || !(byId.has(e.to) || tl)) return;
      let miss = false;
      const near = (l: FigGroup, k: number, after: boolean) => {
        const ks = showing(l);
        const hit = after ? ks.find((b) => b >= k) : ks.findLast((b) => b <= k);
        if (hit != null) return hit;
        miss = true;
        return after ? ks.at(-1) : ks[0];
      };
      let fb: number | undefined, tb: number | undefined;
      if (!fl) fb = blockOf(e.from);
      if (!tl) tb = blockOf(e.to);
      if (fl && tl) fb = showing(fl)[0];
      if (fl && !tl) fb = near(fl, tb!, false);
      if (tl) tb = near(tl, fb!, true);
      if (fb == null || tb == null) return void (wrapped && lost.push(id));
      if (miss) lost.push(id);
      ends.set(id, [fb, tb]);
      if (fb === tb) return;
      const texts = stubTexts(e.label, (byId.get(e.from) ?? fl)!.label, (byId.get(e.to) ?? tl)!.label);
      stubs.set(id, texts);
    });
    // A label wider than the gap would cover a box, so the gap grows.
    const label = Array.from({ length: n }, () => 0);
    for (const e of fig.edges) {
      const [a, b] = [cols.get(e.from), cols.get(e.to)];
      if (e.label == null || a == null || b == null || Math.abs(a - b) !== 1 || colBlock(a) !== colBlock(b)) continue;
      const w = labelPillW(str(e.label));
      if (w - 2 > LANE_GAP) label[Math.min(a, b)] = Math.max(label[Math.min(a, b)], w + 8);
    }
    const gaps = colW.map((_, c) => (c === starts[colBlock(c) + 1] - 1 ? FRAME_SIDE : Math.max(LANE_GAP, label[c])));
    const per = Math.max(...starts.slice(1).map((e, k) => e - starts[k]));
    const lead = Array.from({ length: count }, () => 0);
    const want = (text: string) => STUB + labelPillW(text) + STUB_CLEAR;
    const fit = blocks.every((k) => widthOf(starts[k], starts[k + 1], gaps, 0) <= room);
    const out = new Map<number, number>(),
      inn = new Map<number, number>();
    const roomOut = new Set<number>(),
      roomIn = new Set<number>();
    for (const [id, texts] of stubs) {
      const e = fig.edges.find((x) => edgeId(x) === id)!;
      const [a, b] = [cols.get(e.from), cols.get(e.to)];
      if (a != null) out.set(a, Math.max(out.get(a) ?? 0, want(texts[0])));
      if (b != null) inn.set(b, Math.max(inn.get(b) ?? 0, want(texts[1])));
    }
    for (const k of blocks) {
      const [c0, end] = [starts[k], starts[k + 1]];
      let free = room - widthOf(c0, end, gaps, 0);
      const grow = (extra: number, apply: () => void) => {
        if (extra > 0 && extra <= free) {
          free -= extra;
          apply();
        }
      };
      grow(inn.get(c0) ?? 0, () => (lead[k] = inn.get(c0)!));
      if (!inn.has(c0) || lead[k]) roomIn.add(c0);
      for (let c = c0; c < end; c++) {
        const need = (out.get(c) ?? 0) + (c < end - 1 ? (inn.get(c + 1) ?? 0) : 0);
        grow(need - gaps[c], () => (gaps[c] = need));
        if (gaps[c] >= need) roomOut.add(c).add(-1 - (c + 1));
      }
    }
    const laneIndex = (id: string) => lanes.findIndex((l) => l.id === id || l.children.some((b) => (b as FigNode).id === id));
    const tall = new Set<string>();
    for (const [id] of stubs) {
      const e = fig.edges.find((x) => edgeId(x) === id)!;
      const [a, b] = [cols.get(e.from), cols.get(e.to)];
      const [fb, tb] = ends.get(id)!;
      if (a == null || !roomOut.has(a)) tall.add(`${laneIndex(e.from)}@${fb}`);
      if (b == null || !(b === starts[tb] ? roomIn.has(b) : roomOut.has(-1 - b))) tall.add(`${laneIndex(e.to)}@${tb}`);
    }
    const laneOfBox = new Map(lanes.flatMap((l) => l.children.map((b) => [(b as FigNode).id, l] as const)));
    const around = new Set(
      fig.edges
        .filter((e) => {
          const [a, b, l] = [cols.get(e.from), cols.get(e.to), laneOfBox.get(e.from)];
          if (e.around || a == null || b == null || !l || l !== laneOfBox.get(e.to) || colBlock(a) !== colBlock(b)) return false;
          return (l.children as FigNode[]).some((x) => cols.get(x.id)! > Math.min(a, b) && cols.get(x.id)! < Math.max(a, b));
        })
        .map(edgeId),
    );
    return [{ cols, starts, per, blocks, gutter, gaps, lead, ends, stubs, around, tall, lost }, fit] as const;
  };
  const widthOf = (c: number, end: number, gaps: number[], lead: number) =>
    gutter + lead + colW.slice(c, end).reduce((a, w) => a + w, 0) + gaps.slice(c, end).reduce((a, g) => a + g, 0);
  if (font < minText || floor > limit) return plan(1)[0];
  for (let count = 1; count <= Math.max(1, Math.floor(n / 2)); count++) {
    const [p, fit] = plan(count);
    if (fit) return p;
  }
  return plan(1)[0];
}
/** The rect id that an edge end routes to in wrapped lanes. A stub end is a point in the band. */
export function laneEnd(
  plan: LanePlan,
  edge: string,
  id: string,
  start: boolean,
  band: (lane: string, block: number) => Rect | undefined,
  rects: Record<string, Rect>,
): string {
  const k = plan.ends.get(edge)?.[start ? 0 : 1];
  const b = k == null ? undefined : band(id, k);
  if (plan.blocks.length < 2 || plan.cols.has(id) || !b) return id;
  const texts = plan.stubs.get(edge);
  const key = texts ? `${edge}@${start ? 's' : 't'}` : `${id}@${k}`;
  const x = start ? b.x + b.w - (STUB + labelPillW(texts?.[0] ?? '') + STUB_CLEAR) : b.x + plan.gutter + plan.lead[k!];
  rects[key] = texts ? { x, y: b.y, w: 0, h: b.h } : b;
  return key;
}
export const TL_BAR_H = 28,
  TL_ROW_GAP = 8,
  TL_MIN_BAR = 24,
  TL_DIAMOND = 14,
  TL_AXIS_H = 28,
  TL_AXIS_W = 640;

export const dayOf = (iso: string): number | null => {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(t).toISOString().slice(0, 10) === iso ? t / 86400000 : null;
};

export type TimelineItem = {
  id: string;
  track: number;
  row: number;
  x: number;
  w: number;
  milestone: boolean;
  labelInside: boolean;
  /** The `from` date in the d MMM form, for the playhead label. */
  date: string;
};
export type TimelineLayout = {
  /** The range in days, rounded out to whole Monday-to-Sunday weeks. */
  start: number;
  end: number;
  /** The week ticks (`W41`) or the month ticks (`Oct`). */
  ticks: { x: number; label: string }[];
  /** Bars and milestones. `x` and `w` are px in the axis. */
  items: TimelineItem[];
  /** The row count of each track. */
  rows: number[];
  /** The x of the today marker, or null with no valid `today`. */
  today: number | null;
  /** The x and date of the last day. Null x: no dated item. */
  last: number | null;
  lastDate: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (day: number) => new Date(day * 86400000);
// Day 0 is a Thursday, so this is 0 for Monday and 6 for Sunday.
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;
// ISO 8601: the week with the first Thursday of the year is week 1.
const isoWeek = (day: number) => {
  const thu = day - weekday(day) + 3;
  const jan1 = Date.UTC(dateOf(thu).getUTCFullYear(), 0, 1) / 86400000;
  return Math.floor((thu - jan1) / 7) + 1;
};

const datedItems = (fig: FlowProps) => {
  const out: { id: string; track: number; from: number; to: number | null; label: FigNode }[] = [];
  fig.layout.children.forEach((c, track) =>
    nodes(isGroup(c) ? c : { children: [c] }).forEach((n) => {
      const from = n.from == null ? null : dayOf(n.from);
      if (from == null) return;
      const to = n.to == null ? null : dayOf(n.to);
      out.push({ id: n.id, track, from, to: to != null && to >= from ? to : null, label: n });
    }),
  );
  return out;
};

/** Where each dated item, tick and the today line sit on the axis, `axisWidth` px wide. Both renderers call it. */
export function timelineLayout(fig: FlowProps, axisWidth: number): TimelineLayout {
  const items = datedItems(fig);
  const today = fig.today == null ? null : dayOf(fig.today);
  const days = [...items.flatMap((i) => [i.from, i.to ?? i.from]), ...(today == null ? [] : [today])];
  const first = days.length ? Math.min(...days) : 0;
  const last = days.length ? Math.max(...days) : 0;
  const start = first - weekday(first);
  let end = last + (6 - weekday(last));
  const px = (day: number) => ((day - start) / (end - start + 1)) * axisWidth;
  // After 4 passes the label stays, and `check` reports it.
  for (let pass = 0; pass < 4; pass++) {
    const over = Math.max(
      0,
      ...items.map((i) => {
        const x = i.to != null ? px(i.from) : px(i.from) - TL_DIAMOND / 2;
        const w = i.to != null ? Math.max(TL_MIN_BAR, px(i.to + 1) - px(i.from)) : TL_DIAMOND;
        const need = textWidth(str(i.label.label), 13);
        return i.to != null && need + 16 <= w ? 0 : x + w + 6 + need - axisWidth;
      }),
    );
    if (over <= 0) break;
    end += Math.ceil(over / (axisWidth / (end - start + 1)) / 7) * 7;
  }

  const ticks: TimelineLayout['ticks'] = [];
  if ((end - start + 1) / 7 <= 16) for (let d = start; d <= end; d += 7) ticks.push({ x: px(d), label: `W${isoWeek(d)}` });
  else
    for (let d = start; d <= end; d++) if (dateOf(d).getUTCDate() === 1) ticks.push({ x: px(d), label: MONTHS[dateOf(d).getUTCMonth()] });

  const rows = fig.layout.children.map(() => 1);
  const placed: TimelineItem[] = [];
  const rowEnd: number[][] = fig.layout.children.map(() => []);
  const MIN_ITEM_GAP = 8;
  for (const i of [...items].sort((a, b) => a.from - b.from)) {
    const bar = i.to != null;
    const x = bar ? px(i.from) : px(i.from) - TL_DIAMOND / 2;
    const w = bar ? Math.max(TL_MIN_BAR, px(i.to! + 1) - px(i.from)) : TL_DIAMOND;
    const need = textWidth(str(i.label.label), 13);
    const labelInside = bar && need + 16 <= w;
    let row = rowEnd[i.track].findIndex((until) => until + MIN_ITEM_GAP <= x);
    if (row < 0) row = rowEnd[i.track].length;
    rowEnd[i.track][row] = labelInside ? x + w : x + w + 6 + need;
    rows[i.track] = Math.max(rows[i.track], row + 1);
    placed.push({ id: i.id, track: i.track, row, x, w, milestone: !bar, labelInside, date: fmt(i.from) });
  }
  const order = new Map(items.map((i, k) => [i.id, k]));
  placed.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    start,
    end,
    ticks,
    items: placed,
    rows,
    today: items.length && today != null ? px(today) : null,
    last: items.length ? px(last) : null,
    lastDate: fmt(last),
  };
}

const fmt = (d: number) => `${dateOf(d).getUTCDate()} ${MONTHS[dateOf(d).getUTCMonth()]}`;
/** One step with one beat for each dated item, in date order. */
export function timelineBeats(fig: FlowProps): FigStep[] {
  const items = datedItems(fig).sort((a, b) => a.from - b.from);
  const flow: FigBeat[] = items.map((i, k) => ({
    focus: [i.id],
    light: items.slice(0, k + 1).map((p) => p.id),
    say: `${str(i.label.label)}, ${fmt(i.from)}${i.to != null ? ` to ${fmt(i.to)}` : ''}${i.label.sub != null ? ` · ${str(i.label.sub)}` : ''}`,
  }));
  return [{ label: 'timeline', flow }];
}
const labeledGroups = (g: FigGroup): number => (g.label ? 1 : 0) + g.children.reduce((n, c) => n + (isGroup(c) ? labeledGroups(c) : 0), 0);
export const counts = (p: FlowProps) => {
  const st = p.timeline && isLanesLayout(p.layout) && !p.steps?.length ? timelineBeats(p) : (p.steps ?? []);
  return {
    boxes: nodes(p.layout).length,
    groups: labeledGroups(p.layout),
    edges: p.edges.length,
    steps: st.length,
    messages: st.reduce((n, s) => n + s.flow.reduce((m, b) => m + toBeat(b).hops.length, 0), 0),
  };
};

export const idsIn = (c: FigNode | FigGroup): string[] => (isGroup(c) ? [...(c.id ? [c.id] : []), ...c.children.flatMap(idsIn)] : [c.id]);

const LINE_CLEAR = 16;

export function groupGap(g: FigGroup, edges: FigEdge[]): number {
  const side = new Map<string, number>();
  g.children.forEach((c, i) => idsIn(c).forEach((id) => side.set(id, i)));
  const spans = edges.filter(
    (e) => e.label != null && side.has(e.from) && side.has(e.to) && side.get(e.from) !== side.get(e.to) && !(g.gap != null && e.around),
  );
  if (g.gap != null && !spans.length) return g.gap;
  const need = Math.max(0, ...spans.map((e) => labelPillW(str(e.label)) + 2 * LINE_CLEAR));
  if (g.gap != null && g.direction !== 'column') return Math.max(g.gap, need);
  let auto: number;
  if (g.direction === 'column') {
    const ends = spans.map((e) => [side.get(e.from)!, side.get(e.to)!].sort((p, q) => p - q));
    const most = Math.max(0, ...g.children.map((_, k) => ends.filter(([lo, hi]) => lo <= k && k < hi).length));
    auto = most ? Math.min(most, 3) * 22 + 2 * LINE_CLEAR - 4 : 28;
  } else auto = Math.max(56, need);
  return Math.max(g.gap ?? 0, auto);
}

export const altText = (fig: FlowProps): { title: string; desc: string } => {
  const names = new Map<string, string>();
  const walk = (g: FigGroup) =>
    g.children.forEach((c) => {
      if (c.id) names.set(c.id, str(c.label) || c.id);
      if (isGroup(c)) walk(c);
    });
  walk(fig.layout);
  const name = (id: string) => names.get(id) ?? id;
  const ends = new Map(fig.edges.map((e) => [edgeId(e), e]));
  const boxes = nodes(fig.layout).map((n) => name(n.id));
  const steps = fig.steps ?? [];
  const lines = steps.flatMap((s) => [
    `${str(s.label)}.`,
    ...s.flow.map(toBeat).flatMap((b) => {
      if (str(b.say)) return [str(b.say)];
      return b.hops.flatMap((h) => {
        const e = ends.get(h.edge);
        if (!e) return [];
        return [h.back ? `${name(e.to)} to ${name(e.from)}` : `${name(e.from)} to ${name(e.to)}`];
      });
    }),
  ]);
  return {
    title: `Flow figure: ${boxes.join(', ')}.${steps.length ? ` Steps: ${steps.map((s) => str(s.label)).join(', ')}.` : ''}`,
    desc: [`The figure has these boxes: ${boxes.join(', ')}.`, ...lines].join('\n'),
  };
};

const keyOf = (v: unknown, path: object[]): unknown => {
  if (typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v !== 'object' || v === null) return v;
  if (path.includes(v)) return '[cycle]';
  const at = [...path, v];
  if (Array.isArray(v)) return v.map((x) => keyOf(x, at));
  const el = v as { $$typeof?: unknown; type?: { name?: string } | string; key?: unknown; props?: unknown };
  const proto = Object.getPrototypeOf(v);
  if (!el.$$typeof && proto !== Object.prototype && proto !== null) return '[object]';
  const src = el.$$typeof ? { type: typeof el.type === 'string' ? el.type : el.type?.name, key: el.key, props: el.props } : v;
  return Object.fromEntries(Object.entries(src).flatMap(([k, x]) => (k === 'ref' || k.startsWith('_') ? [] : [[k, keyOf(x, at)]])));
};
export const specKey = (...parts: unknown[]) => JSON.stringify(keyOf(parts, []));
// Edge labels are 11 px, the smallest reader text at scale 1.
const READER_PX = 11;
const DESKTOP_PX = 9;
const DESKTOP_BOX = 600;
export const textFloor = (box: number) => (box < DESKTOP_BOX ? READER_PX : DESKTOP_PX);
export const fitScale = (wide: number, box: number, map: number) => Math.max(wide ? 1 : textFloor(box) / READER_PX, Math.min(1, box / map));
const folds = (box: number, row: number) => box * READER_PX < row * textFloor(box);
export const nextWide = (wide: number, box: number, map: number) => {
  const row = Math.abs(wide) || map;
  if (!folds(box, row)) return 0;
  return wide > 0 && map >= wide ? -wide : wide || map;
};
