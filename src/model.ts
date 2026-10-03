// The figure format and the pure helpers that read it. No React rendering here, so it can be tested directly.
import type { ReactNode } from 'react';
import { textWidth } from './text.ts';

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
/** The gap between two blocks of wrapped lanes. A cross-block edge runs along the middle of it. */
export const LANE_BLOCK_GAP = 40;

/** The width of a box as the SVG draws it, before a diamond adds its 70 px. */
export function nodeWidth(item: FigNode, carded: boolean): number {
  if (item.width != null) return item.width;
  if (carded) return CARD_WIDTH;
  const label = textWidth(str(item.label), 14) + 32;
  const sub = textWidth(str(item.sub), 12) + 32;
  return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, label, sub));
}

/** The width of the label gutter of lanes and of a timeline: the widest track label plus the frame sides. */
export const laneGutter = (lanes: FigGroup[]) =>
  Math.max(0, ...lanes.map((l) => textWidth(str(l.label).toUpperCase(), 12))) + FRAME_SIDE * 2;

/**
 * The time columns per block of a lanes figure. If all the columns do not fit `width` with text at `minText` or more, the lanes
 * wrap like a line of text: block 1 holds columns 0..n-1, block 2 holds n..2n-1. n is the largest count that fits; it is 1 at least.
 * The text test is the one `check` runs: the smallest text (11 px, or 10.5 px with a mono card row) times width / figure width.
 * Both renderers call it with the SVG box widths, so the player shows the same blocks as the SVG.
 */
export function laneWrap(fig: FlowProps, { width = 830, minText = 10, padding = 24 } = {}): number {
  const cols = laneColumns(fig);
  const n = Math.max(-1, ...cols.values()) + 1;
  const shown = (fig.steps ?? []).flatMap((s) => s.flow.flatMap((b) => Object.entries(toBeat(b).show ?? {})));
  const carded = new Set(shown.map(([id]) => id));
  const mono = shown.some(([, c]) => isRows(c) && c.some((r) => r.mono));
  const colW = Array.from({ length: n }, () => 0);
  for (const b of nodes(fig.layout)) {
    const c = cols.get(b.id)!;
    colW[c] = Math.max(colW[c], nodeWidth(b, carded.has(b.id)) + (b.shape === 'decision' ? 70 : 0));
  }
  const room = (width * (mono ? 10.5 : 11)) / minText - padding * 2;
  const fixed = laneGutter(fig.layout.children as FigGroup[]) + FRAME_SIDE;
  const fits = (k: number) => {
    for (let c = 0; c < n; c += k) {
      const ws = colW.slice(c, c + k);
      if (fixed + ws.reduce((a, w) => a + w, 0) + LANE_GAP * (ws.length - 1) > room) return false;
    }
    return true;
  };
  let k = Math.max(1, n);
  while (k > 1 && !fits(k)) k--;
  return k;
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
