// The figure format and the pure helpers that read it. No React rendering here, so it can be tested directly.
import type { ReactNode } from 'react';
import { textWidth, wrap } from './text.ts';
import type { Rect } from './geometry.ts';

/** A box in the figure. A box with a `show` in some step becomes a content card: it grows to fit the most any step puts in it. */
export type FigNode = {
  /** Name that edges, steps and beats use to point at this box. Must be unique in the figure. */
  id: string;
  /** The title in the box. */
  label: ReactNode;
  /** A smaller line under the label. */
  sub?: ReactNode;
  /** `box` is a rounded box, `decision` a diamond, `store` a database cylinder for data at rest. Default: `box`. */
  shape?: 'box' | 'decision' | 'store';
  /** The least number of text lines a content card keeps. The card still grows to fit its content. */
  lines?: number;
  /** Width in px. Overrides the width the layout picks. */
  width?: number;
  /** In a `lanes` figure: the time column of the box, 0-based. Default: the box's first appearance in the steps. */
  at?: number;
  /** In a `timeline` figure: the start of the item, or the date of a milestone, as YYYY-MM-DD. */
  from?: string;
  /** In a `timeline` figure: the last day of the item, as YYYY-MM-DD. The day counts. Without it the box is a milestone. */
  to?: string;
  /** A permanent state color for the box, such as a failing part. It gives a 1 px border and a light tint. An arrival with no hop tone uses it too. */
  tone?: FigTone;
  /** A lifecycle mark: `start` draws a filled dot before the box, `end` a ringed dot after it. No layout change. */
  mark?: 'start' | 'end';
  /** The code this draws, `path` or `path#symbol`, relative to the repo root. `flowfig verify` checks it. */
  source?: string;
};
/** A frame that lays out its children in a row or a column. Groups can hold groups. */
export type FigGroup = {
  /** Name that edges can point at, to reach the group as a whole. */
  id?: string;
  /** The title on the frame. A group with a label is drawn as a frame around its children. */
  label?: ReactNode;
  /** `row` puts the children side by side, `column` stacks them. Default: `row`. */
  direction?: 'row' | 'column';
  /** Space between children in px. Default: 28 for a column. For a row, wide enough for the widest edge label between two children (at least 56). */
  gap?: number;
  /** Where children line up across the group's direction. Default: center (columns stretch). */
  align?: 'start' | 'center' | 'end';
  /** The boxes and groups inside, in order. */
  children: (FigNode | FigGroup)[];
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
  /** Routes the edge over or under the boxes in between (loops, skip-ahead edges). */
  around?: 'above' | 'below';
  /** Draws the edge only while a step uses it. Use it for long edges that would cut across everything. */
  quiet?: boolean;
  /** The code this draws, `path` or `path#symbol`, relative to the repo root. `flowfig verify` checks it. */
  source?: string;
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
      /** Colors the packet, its data card, the edge and the box it arrives at, for this beat. The trail after the beat stays the accent. Default: the accent. */
      tone?: FigTone;
      /** Marks a message that does not wait for an answer. The rail draws it dashed, with an `async` tag. Default: `false`. */
      async?: boolean;
      /** The code this draws, `path` or `path#symbol`, relative to the repo root. `flowfig verify` checks it. */
      source?: string;
    };
/** One moment of a step. No edges means a pause. */
export type FigBeat = {
  /** The packets that cross in this beat. An array runs them at the same time. */
  edges?: FigHop | FigHop[];
  /** The line of narration for this beat. */
  say?: ReactNode;
  /** Fills the content card of each named box. The card keeps it until the step ends. */
  show?: Record<string, FigContent>;
  /** Ids of boxes to highlight for this beat, without a packet or a content card. */
  light?: string[];
  /** Ids of boxes that take the active look for this beat: a 2 px border, a tint and a glow. The boxes in `light` keep the trail look. */
  focus?: string[];
  /** How long the beat lasts in ms. The packet crosses in `speed`; the rest is a hold. An explicit `ms` wins as written. Default: `speed` plus the time to read `say`. */
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
/** The color of a row tag, a hop or a box. Each tone is a fixed color. */
export type FigTone = 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'gray';
/** What a content card shows: rows, or anything React can render. */
export type FigContent = FigRow[] | ReactNode;
/** One story the figure can tell. The player shows one tab for each step. */
export type FigStep = {
  /** The tab title. */
  label: ReactNode;
  /** The line shown under the figure while no beat of the step has a `say`. */
  caption?: ReactNode;
  /** The beats in play order. A plain hop or hop array is a beat with just edges. */
  flow: (FigHop | FigHop[] | FigBeat)[];
  /** Ids of boxes to highlight for the whole step. */
  nodes?: string[];
};
/** Colors for the figure. Each key sets one color, and a color you leave out keeps the built-in value. */
export type FigTheme = Partial<Record<'accent' | 'fg' | 'muted' | 'bg' | 'surface' | 'border' | 'font', string>>;
/** The spec of one figure. Give it to `Flow` (React) or to `toSvg` (SVG string). */
export type FlowProps = {
  /** The boxes and how they line up. */
  layout: FigGroup;
  /** The arrows between the boxes. */
  edges: FigEdge[];
  /** The stories the figure tells. With no steps, the figure is a still map. */
  steps?: FigStep[];
  /** Colors. Can also be set from CSS with --fig-accent, --fig-bg, ... on `.flowfig`. `font` defaults to `inherit`. */
  theme?: FigTheme;
  /** Milliseconds a packet takes to cross one edge. Default: 900. */
  speed?: number;
  /** Starts playing when the figure mounts. Default: `true`. Only the React player reads it. */
  autoplay?: boolean;
  /** Development aid: run the `flowfig check` rules on what the browser drew, and print the faults with console.warn. Default: `false`. */
  check?: boolean;
  /** Draw the steps as a lifeline rail under the map: one row for each message, with its payload. `'only'` draws the rail without the map. Default: `false`. */
  rail?: boolean | 'only';
  /** Draw the layout as swimlanes: a `column` group of labeled groups, one per role, with the boxes in time order left to right. Default: off. */
  lanes?: true;
  /** Draw the layout as a timeline: one labeled group per track, with the boxes placed by their `from` and `to` dates. Default: off. */
  timeline?: true;
  /** In a `timeline` figure: the date of the fixed today marker, as YYYY-MM-DD. With no `today`, the figure has no marker. */
  today?: string;
};
/** A figure file's default export: a title, a source note and the props. */
export type Figure = { title: string; source?: string; props: FlowProps };

/** A beat with its hops spelled out: every hop has an edge id and a direction. */
export type Beat = Omit<FigBeat, 'edges'> & {
  hops: { edge: string; back: boolean; data?: ReactNode; tone?: FigTone; async?: boolean; source?: string }[];
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

/** A React node can be an object too, so a row is told apart by its `text` key. */
export const isRows = (c: FigContent): c is FigRow[] =>
  Array.isArray(c) && c.every((r) => r != null && typeof r === 'object' && 'text' in r);

export const edgeId = (e: FigEdge) => e.id ?? `${e.from}->${e.to}`;
export const isGroup = (x: FigNode | FigGroup): x is FigGroup => 'children' in x;
export const decisions = (g: FigGroup): string[] =>
  g.children.flatMap((c) => (isGroup(c) ? decisions(c) : c.shape === 'decision' ? [c.id] : []));

/** The width of a content card in px. Both renderers use it, so a figure lays out the same way in each. */
export const CARD_WIDTH = 166;
/** The player runs 1.25 times faster than the timings in a figure: figure timings are written to be read slowly. The SVG matches it. */
export const BASE_RATE = 1.25;
/** The height of one text line in a content card, and the padding above and below the lines. */
export const CARD_LINE = 15,
  CARD_PAD = 6;
/** The fixed color of each row tone. */
export const TONES: Record<FigTone, string> = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  green: '#10b981',
  orange: '#f59e0b',
  red: '#ef4444',
  gray: '#8b949e',
};
/** A tone as a fill under white text: darker, so the text keeps its contrast. */
export const toneFill = (c: string) => `color-mix(in srgb, ${c} 64%, #000)`;
/** The light tint of a tone over a background: the fill of a toned box. */
export const toneTint = (c: string, bg: string, pct = 8) => `color-mix(in srgb, ${c} ${pct}%, ${bg})`;
/** The width of an edge-label pill in px: the label text plus its padding. The rail uses it for a payload, so both look the same. */
export const labelPillW = (label: string) => textWidth(label, 11, true) + 14;
/** The width of the `async` tag in px. */
export const ASYNC_TAG_W = textWidth('ASYNC', 9) + 8;
/** The stroke width in px of an edge that a packet crosses now, and of an idle edge. */
export const EDGE_ON = 2,
  EDGE_OFF = 1.25;

/** The built-in colors. Both renderers and `flowfig check` read these, so they cannot drift apart. */
export const LIGHT = { accent: '#0074d9', fg: '#1c1e21', muted: '#606770', bg: '#ffffff', surface: '#f5f7fa', border: '#d0d7de' };
// The dark accent is darker than a typical dark-mode blue: white text sits on it and needs 4.5:1.
export const DARK = { accent: '#1f78c8', fg: '#e3e3e3', muted: '#9aa0a6', bg: '#1b1b1d', surface: '#242526', border: '#3a3b3c' };
/** Text on an accent fill: the data chips and a lit edge label. */
export const ON_ACCENT = '#ffffff';

/** Only text survives outside React: a React element has no string form. */
export const str = (n: unknown): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '');
/** The time a reader needs for a caption line: 400 ms plus 240 ms per word. The result is 0 for no text. */
export const readMs = (say: unknown): number => {
  const w = str(say).split(/\s+/).filter(Boolean).length;
  return w ? 400 + 240 * w : 0;
};
/** How long a beat lasts. An explicit `ms` wins as written. Else the beat lasts `speed` plus the time to read `say`. */
export const beatMs = (b: Beat, speed: number): number => b.ms ?? speed + readMs(b.say);
/** The item the playhead rests on at beat `i`: the first dated id in the latest focus up to `i`, or undefined for home. */
export const playheadItem = <T extends { id: string }>(items: T[], beats: { focus?: string[] }[], i: number): T | undefined => {
  for (let k = Math.min(i, beats.length - 1); k >= 0; k--) {
    const id = (beats[k].focus ?? []).find((f) => items.some((x) => x.id === f));
    if (id != null) return items.find((x) => x.id === id);
  }
  return undefined;
};

/** The box of a timeline label that sits beside its bar, in the bar's coordinates. */
export const outsideLabelRect = (bar: { x: number; y: number; w: number; h: number }, label: string) => ({
  x: bar.x + bar.w + 6,
  y: bar.y,
  w: textWidth(label, 13),
  h: bar.h,
});

/**
 * The time span in which the playhead label shows its date. The label waits for the line to arrive: it stays hidden for
 * the ramp (the move), so it never shows a date at a place that is not that date, and it never meets "today" on the way.
 */
export const labelSpan = (t0: number, end: number, ramp: number): [number, number] => [Math.min(t0 + ramp, end), end];

/** True if a playhead date label at x would overlap the "today" label, so it moves to the top row. Widths are in px. */
export const dateLabelRaised = (x: number, today: number | null | undefined, w: number, todayW: number): boolean =>
  today != null && x + 3 < today - 3 && x + 3 + w > today - 3 - todayW;

/** The hold at the end of each step, before the next step starts. */
export const STEP_HOLD_MS = 2000;
export const nodes = (g: FigGroup): FigNode[] => g.children.flatMap((c) => (isGroup(c) ? nodes(c) : [c]));
/** Lane layout constants, shared by both renderers: the gap between time columns, the padding inside a lane, and the gap between lanes. */
export const LANE_GAP = 56,
  LANE_PAD = 24,
  LANE_ROW_GAP = 20;

/** True if the layout can draw as lanes: a `column` group whose every child is a labeled group with boxes only. */
export const isLanesLayout = (g: FigGroup): boolean =>
  g.direction === 'column' && g.children.every((c) => isGroup(c) && c.label != null && c.children.every((k) => !isGroup(k)));

/** True if `at` is a usable time column: an integer of 0 or more. */
export const validAt = (at: unknown): at is number => typeof at === 'number' && Number.isInteger(at) && at >= 0;

/** The time column of each box in a lanes figure: its first appearance in the steps (from, then to; a back hop to, then from),
 * then the boxes no step touches in layout order. `at` overrides. Two boxes may share a column. */
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

/** The side of an SVG frame, and the width limits of a box with no card. The lane split measures with them. */
export const FRAME_SIDE = 18,
  NODE_MIN_W = 100,
  NODE_MAX_W = 190;
/** The gap between two blocks of wrapped lanes. */
export const LANE_BLOCK_GAP = 40;
/** The length of a stub line between a box and its pill, the clear space past a pill, and the room a lane grows by for a pill. */
export const STUB = 12,
  STUB_CLEAR = 8,
  STUB_ROOM = 30;

/** The width of a box as the SVG draws it, before a diamond adds its 70 px. */
export function nodeWidth(item: FigNode, carded: boolean): number {
  if (item.width != null) return item.width;
  if (carded) return CARD_WIDTH;
  const label = textWidth(str(item.label), 14) + 32;
  const sub = textWidth(str(item.sub), 12) + 32;
  return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, label, sub));
}

/** The room a diamond of size w by h gives a text line whose far edge sits `far` px from the center: the width of the outline there, less 8 px. */
export const diamondRoom = (w: number, h: number, far: number) => w * Math.max(0, 1 - far / (h / 2)) - 8;
/** The lines of a diamond with no card. The sub wraps to the room the outline gives its last line; the diamond grows taller by 15 px
 * for each line until the lines fit. `dy` is the baseline of each line below the center, as the SVG draws it: the label sits 2 px
 * above the center over a one-line sub, and 5 px below it with no sub. `far` is the distance from the center to the far edge of the text. */
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

/** The width of the label gutter of lanes and of a timeline: the widest track label plus the frame sides. */
export const laneGutter = (lanes: FigGroup[]) =>
  Math.max(0, ...lanes.map((l) => textWidth(str(l.label).toUpperCase(), 12))) + FRAME_SIDE * 2;

/** How a lanes figure wraps. Both renderers lay out with it, so the player shows the blocks and stubs of the SVG. */
export type LanePlan = {
  /** The time column of each box. */
  cols: Map<string, number>;
  /** The first column of each block, then the column count: block k holds columns starts[k] to starts[k + 1] - 1. */
  starts: number[];
  /** The most columns in one block. */
  per: number;
  /** The blocks that hold a box, in order. A block with no box is not drawn. A figure with no box keeps block 0. */
  blocks: number[];
  /** The width of the label gutter, the same in every block. */
  gutter: number;
  /** The space after each column: the gap to the next column of its block, or the right margin of the band for the last one. */
  gaps: number[];
  /** The room before the first column of each block, after the gutter. */
  lead: number[];
  /** The block of the source and of the target of each edge, by edge id. A lane end names the copy of the lane in that block. */
  ends: Map<string, [number, number]>;
  /** The edges whose ends sit in two blocks, by edge id: the pill texts at the source and at the target, then a shorter source
   * text without the edge label, if the edge has one. */
  stubs: Map<string, string[]>;
  /** Edges between two boxes of one lane and one block, with a box of that lane between them and no `around` of their own.
   * A straight route would cross that box, so the renderers route them around below. */
  around: Set<string>;
  /** The lane copies (`laneIndex@block`) that grow by STUB_ROOM at the bottom: a stub pill there has no room beside its box. */
  tall: Set<string>;
  /** Edges with a lane end that has no block on the side of the other end. They use the nearest block; `check` reports them. */
  lost: string[];
};

/** The block of a time column, from the block starts of a plan. */
export const laneBlock = (starts: number[], c: number): number => {
  let k = 0;
  while (k < starts.length - 2 && c >= starts[k + 1]) k++;
  return k;
};

/** The pill texts of a cross-block edge: "label → Target" at the source, "from Source" at the target, and "→ Target", a
 * shorter source text for a pill that has no place for the long one. */
export const stubTexts = (label: unknown, from: unknown, to: unknown): string[] => [
  `${str(label) ? str(label) + ' ' : ''}→ ${str(to)}`,
  `from ${str(from)}`,
  ...(str(label) ? [`→ ${str(to)}`] : []),
];

/**
 * The wrap of a lanes figure. If all the time columns do not fit `width` with text at `minText` or more, the lanes wrap like a
 * line of text: block 1 holds columns 0..n-1, block 2 holds n..2n-1. n is the largest count that fits; it is 1 at least.
 * The text test is the one `check` runs: the smallest text (11 px, or 10.5 px with a mono card row) times width / figure width.
 * If the wrap cannot make the text readable, the lanes do not wrap: the smallest font is under `minText`, or `floor` (the least
 * width of the rest of the figure, such as the rail) is already too wide.
 * The blocks share the columns as evenly as they can, and a block holds 2 columns at least: if 2 do not fit, the lanes keep
 * one block. An edge between two blocks becomes two stubs with pills. A pill takes no room of its own, so n depends on the boxes.
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
    // count blocks share the n columns evenly; the first n % count blocks take one column more.
    const starts = [0];
    for (let k = 0; k < count; k++) starts.push(starts[k] + Math.floor(n / count) + (k < n % count ? 1 : 0));
    const colBlock = (c: number) => laneBlock(starts, c);
    const blockOf = (id: string) => colBlock(cols.get(id)!);
    const held = [...new Set([...byId.keys()].map(blockOf))].sort((a, b) => a - b);
    const blocks = held.length ? held : [0];
    const wrapped = blocks.length > 1;
    // The blocks that show a lane: a wrapped block shows only the lanes with a box in it.
    const showing = (l: FigGroup) =>
      wrapped ? [...new Set((l.children as FigNode[]).map((b) => blockOf(b.id)))].sort((a, b) => a - b) : blocks;
    const stubs = new Map<string, string[]>();
    const ends = new Map<string, [number, number]>();
    const lost: string[] = [];
    fig.edges.forEach((e) => {
      const id = edgeId(e);
      const [fl, tl] = [laneOf.get(e.from), laneOf.get(e.to)];
      if (!(byId.has(e.from) || fl) || !(byId.has(e.to) || tl)) return;
      // A lane source takes the last block at or before the target that shows it; a lane target the first at or after the source.
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
    // A pill takes no room of its own: the route puts it in free space (route() in geometry.ts), so n depends on the boxes only.
    // A label on an edge between two next columns of one block sits in the gap between them. A label too wide for the gap would
    // cover a box, so that gap grows to the label plus 8 px. A label that fits keeps the gap of 0.4.0.
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
    // A pill takes free room only: a gap next to a stub end grows for its pill while the block still fits the width. So the
    // block count never depends on a pill. A pill with no room finds a free place in route() (geometry.ts).
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
        if (gaps[c] >= need) roomOut.add(c).add(-1 - (c + 1)); // -1 - c marks room before column c
      }
    }
    // A stub end with no room beside its box makes its lane taller in that block: the pill then fits under the box, inside the band.
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
  // The wrap only narrows the lanes. If the text stays too small at any width, keep one block, and check reports small-text.
  if (font < minText || floor > limit) return plan(1)[0];
  // A block has 2 columns at least: one column per block reads as a list, not as lanes. If 2 do not fit, keep one block.
  // The fit uses the boxes and the label gaps only, before a pill takes free room.
  for (let count = 1; count <= Math.max(1, Math.floor(n / 2)); count++) {
    const [p, fit] = plan(count);
    if (fit) return p;
  }
  return plan(1)[0];
}
/**
 * The rect id that an edge end routes to in wrapped lanes. A box keeps its id. A lane has one band per block, so a lane end names
 * the band in the block from the plan (`band` finds it). A stub end at a lane is a point inside that band: the source at the band
 * end, past the room for its pill, and the target at the first column of the block. The function adds the rect it names to `rects`.
 */
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
/** Timeline constants, shared by both renderers: the bar height, the gap between rows, the least bar width, the milestone width,
 * the axis strip height and the axis width of the SVG. */
export const TL_BAR_H = 28,
  TL_ROW_GAP = 8,
  TL_MIN_BAR = 24,
  TL_DIAMOND = 14,
  TL_AXIS_H = 28,
  TL_AXIS_W = 640;

/** The days since 1970-01-01 (UTC) of a YYYY-MM-DD date. It is null for any other text and for a date that does not exist. */
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
  /** The range in days, rounded out to whole weeks: the Monday of the first week and the Sunday of the last week. */
  start: number;
  end: number;
  /** The week ticks (`W41`) or the month ticks (`Oct`). */
  ticks: { x: number; label: string }[];
  /** Bars and milestones. `x` and `w` are px inside the axis; `row` is the stack row inside the track. */
  items: TimelineItem[];
  /** The row count of each track. */
  rows: number[];
  /** The x of the today marker. It is null when the figure has no valid `today`. */
  today: number | null;
  /** The x and the d MMM date of the last day: the playhead rests there in the step hold. The x is null when the figure has no dated item. */
  last: number | null;
  lastDate: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (day: number) => new Date(day * 86400000);
// Day 0 is a Thursday, so this is 0 for Monday and 6 for Sunday.
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;
/** The ISO 8601 week number of a day: the week of the year's first Thursday is week 1. */
const isoWeek = (day: number) => {
  const thu = day - weekday(day) + 3;
  const jan1 = Date.UTC(dateOf(thu).getUTCFullYear(), 0, 1) / 86400000;
  return Math.floor((thu - jan1) / 7) + 1;
};

/** The boxes with a real `from`, in layout order, with their track (the index of the top-level child) and their days.
 * A `to` that is not a date, or is before `from`, makes the box a milestone; `checkSpec` reports it. */
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
  // A label right of the last items may pass the axis end. Add whole weeks and lay out again; after 4 passes the label stays and `check` reports it.
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
  const busy: number[][] = fig.layout.children.map(() => []); // per track: the px end of the latest item in each row, with its label
  const GAP = 8; // the least px between two items in a row
  for (const i of [...items].sort((a, b) => a.from - b.from)) {
    const bar = i.to != null;
    const x = bar ? px(i.from) : px(i.from) - TL_DIAMOND / 2;
    const w = bar ? Math.max(TL_MIN_BAR, px(i.to! + 1) - px(i.from)) : TL_DIAMOND;
    const need = textWidth(str(i.label.label), 13);
    const labelInside = bar && need + 16 <= w;
    let row = busy[i.track].findIndex((until) => until + GAP <= x);
    if (row < 0) row = busy[i.track].length;
    busy[i.track][row] = labelInside ? x + w : x + w + 6 + need;
    rows[i.track] = Math.max(rows[i.track], row + 1);
    placed.push({ id: i.id, track: i.track, row, x, w, milestone: !bar, labelInside, date: fmt(i.from) });
  }
  // Keep the layout order in the result.
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
/** One step, "timeline", with one beat for each dated item in date order. The beat lights the item and says "label, d MMM to d MMM" (a milestone: "label, d MMM"), then " · sub". */
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
/** The part counts of a spec, for the line that `flowfig check` prints. An agent copies the line into its reply. */
export const counts = (p: FlowProps) => {
  // A timeline with no steps plays one synthetic step.
  const st = p.timeline && isLanesLayout(p.layout) && !p.steps?.length ? timelineBeats(p) : (p.steps ?? []);
  return {
    boxes: nodes(p.layout).length,
    groups: labeledGroups(p.layout),
    edges: p.edges.length,
    steps: st.length,
    messages: st.reduce((n, s) => n + s.flow.reduce((m, b) => m + toBeat(b).hops.length, 0), 0),
  };
};

/** Every id inside a child: its own id, and the ids of all boxes and groups below it. */
const idsIn = (c: FigNode | FigGroup): string[] => (isGroup(c) ? [...(c.id ? [c.id] : []), ...c.children.flatMap(idsIn)] : [c.id]);

/**
 * A group's gap. A row's default gap grows to hold the widest label of an edge between two of its children, with 8px each side:
 * the label sits at the middle of that gap. A gap the author sets stays as set; `flowfig check` reports it if it is too narrow.
 */
export function groupGap(g: FigGroup, edges: FigEdge[]): number {
  if (g.gap != null) return g.gap;
  if (g.direction === 'column') return 28;
  const side = new Map<string, number>();
  g.children.forEach((c, i) => idsIn(c).forEach((id) => side.set(id, i)));
  const pills = edges
    .filter((e) => e.label != null && side.has(e.from) && side.has(e.to) && side.get(e.from) !== side.get(e.to))
    .map((e) => labelPillW(str(e.label)) + 16);
  return Math.max(56, ...pills);
}
