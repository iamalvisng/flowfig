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
  /** How long the beat lasts in ms. The packet crosses in `speed`; the rest is a hold. Default: `speed` plus the time to read `say`. */
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
/** The color of a row tag. Each tone is a fixed color. */
export type FigTone = 'blue' | 'purple' | 'green' | 'orange' | 'gray';
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
};
/** A figure file's default export: a title, a source note and the props. */
export type Figure = { title: string; source?: string; props: FlowProps };

/** A beat with its hops spelled out: every hop has an edge id and a direction. */
export type Beat = Omit<FigBeat, 'edges'> & { hops: { edge: string; back: boolean; data?: ReactNode; async?: boolean; source?: string }[] };
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
  gray: '#8b949e',
};
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
/** The time a reader needs for a caption line: 500 ms plus 300 ms per word. 0 for no text. */
export const readMs = (say: unknown): number => {
  const w = str(say).split(/\s+/).filter(Boolean).length;
  return w ? 500 + 300 * w : 0;
};
/** How long a beat lasts: at least `ms`, else `speed` plus the time to read its `say`. The packet crosses in `speed`; the rest is a hold. */
export const beatMs = (b: Beat, speed: number): number => Math.max(b.ms ?? speed, speed + readMs(b.say));
/** The hold at the end of each step, before the next step starts. */
export const STEP_HOLD_MS = 2500;
export const nodes = (g: FigGroup): FigNode[] => g.children.flatMap((c) => (isGroup(c) ? nodes(c) : [c]));
const labeledGroups = (g: FigGroup): number => (g.label ? 1 : 0) + g.children.reduce((n, c) => n + (isGroup(c) ? labeledGroups(c) : 0), 0);
/** The part counts of a spec, for the line that `flowfig check` prints. An agent copies the line into its reply. */
export const counts = (p: FlowProps) => ({
  boxes: nodes(p.layout).length,
  groups: labeledGroups(p.layout),
  edges: p.edges.length,
  steps: (p.steps ?? []).length,
  messages: (p.steps ?? []).reduce((n, s) => n + s.flow.reduce((m, b) => m + toBeat(b).hops.length, 0), 0),
});

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
