// The same figure, as one self-contained animated SVG: no scripts, no fonts to fetch, so it plays
// inside a markdown image on GitHub, GitLab and Notion, where the React player cannot go. It gives
// up what needs a reader: no hover, no tabs, no pause — every step runs in one loop.
//
// It reads the same spec and the same `route()` as the React renderer, so the two cannot drift.
//
// Limit: text is measured by character class (src/text.ts) rather than by a browser, so this runs anywhere with plain node.
// Wrapping is therefore approximate; `flowfig check` uses the same measure, and the player check measures real text.
import { route, type Pt, type Rect } from './geometry.ts';
import { foldedLabel, groupBox, layoutRail, railState, RAIL, type Rail } from './rail.ts';
import { textWidth } from './text.ts';
import { checkScene, checkSpec, checkTheme, type CheckOptions } from './check.ts';
import type { Finding, Scene, SceneBox } from './scene.ts';
export type { CheckOptions } from './check.ts';
export type { Finding, Scene } from './scene.ts';
export type * from './model.ts';
export { parseSource, links, type Link } from './source.ts';
export { diff, formatDiff, type Change } from './diff.ts';
import {
  ASYNC_TAG_W,
  BASE_RATE,
  CARD_LINE,
  CARD_PAD,
  CARD_WIDTH,
  DARK,
  EDGE_OFF,
  EDGE_ON,
  LIGHT,
  TONES,
  toneFill,
  toneTint,
  labelPillW,
  ON_ACCENT,
  str,
  edgeId,
  groupGap,
  isGroup,
  isRows,
  toBeat,
  beatMs,
  STEP_HOLD_MS,
  type Beat,
  type FigContent,
  type FigGroup,
  type FigNode,
  type FigRow,
  type FigTheme,
  type FigTone,
  type FlowProps,
} from './model.ts';

export { LIGHT, DARK } from './model.ts';

const LINE = CARD_LINE,
  CARD_SIDE = 8,
  ROW_GAP = 4;
const LABEL_LINE = 18,
  SUB_LINE = 15,
  NODE_MIN_W = 100,
  NODE_MAX_W = 190;
const FRAME_TOP = 37,
  FRAME_SIDE = 18,
  FRAME_BOTTOM = 18;

// The card-on fills are fixed colors that approximate the player's 8% accent tint. The active tint is the player's color-mix.
const vars = (t: Record<'accent' | 'fg' | 'muted' | 'bg' | 'surface' | 'border', string>, cardOn: string) =>
  `--accent:${t.accent}; --fg:${t.fg}; --muted:${t.muted}; --bg:${t.bg}; --surface:${t.surface}; --border:${t.border}; --card-on:${cardOn}; --tint:color-mix(in srgb, var(--accent) 10%, var(--surface));`;

/** What a card actually holds: rows, or its text. Only text survives outside React. */
const content = (c: FigContent): FigRow[] | string => (isRows(c) ? c : str(c));
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const n2 = (v: number) => Math.round(v * 10) / 10;
// Keyframe times are fractions of a loop that can last a minute: one decimal would round a 0.7 s hop away, and the packet would jump.
const n4 = (v: number) => Math.round(v * 10000) / 10000;
const pct = (v: number) => Math.round(v * 10000) / 100 + '%';

/** Break a string into lines that fit `width`, keeping the newlines it already has. */
function wrap(s: string, width: number, fontSize: number, mono = false): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!line) line = word;
      else if (textWidth(line + ' ' + word, fontSize, mono) <= width) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A tag pill. The tag is drawn in bold capitals with letter spacing, so the width counts both. */
const pillW = (tag: string) => textWidth(tag.toUpperCase(), 9) + tag.length * 0.27 + 8;

type Row = { row: FigRow; heads: boolean; lines: string[]; room: number };
/** A card's rows, wrapped for `width`, with the height they need. */
function layoutCard(c: FigContent, width: number): { rows: Row[]; height: number } {
  const inner = width - CARD_SIDE * 2;
  if (c == null) return { rows: [], height: LINE + CARD_PAD * 2 };
  const body = content(c);
  if (!Array.isArray(body)) {
    const lines = wrap(body || ' ', inner, 11);
    return { rows: [{ row: { text: body }, heads: false, lines, room: inner }], height: lines.length * LINE + CARD_PAD * 2 };
  }
  const rows = body.map((row) => {
    // A word-sized tag heads its row so the text keeps the full width; a number or no tag sits inline.
    const heads = (row.tag?.length ?? 0) > 2;
    const tagW = row.tag && !heads ? pillW(row.tag) + 5 : 0;
    const markW = row.mark && !heads ? textWidth(str(row.mark), 11) + 6 : 0;
    const body = str(row.text) + (row.meta != null ? ' · ' + str(row.meta) : '');
    const room = inner - tagW - markW;
    return { row, heads, lines: wrap(body, room, row.mono ? 10.5 : 11, row.mono), room };
  });
  const height =
    rows.reduce((h, r) => h + (r.heads ? LINE : 0) + r.lines.length * LINE, 0) + ROW_GAP * Math.max(0, rows.length - 1) + CARD_PAD * 2;
  return { rows, height };
}

type Placed = Rect & { item: FigNode | FigGroup };
type Sizes = { cards: Map<string, FigContent[]>; cardH: Map<string, number>; minH: (id: string) => number; gap: (g: FigGroup) => number };

function nodeWidth(item: FigNode, carded: boolean): number {
  if (item.width != null) return item.width;
  if (carded) return CARD_WIDTH;
  const label = textWidth(str(item.label), 14) + 32;
  const sub = textWidth(str(item.sub), 12) + 32;
  return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, label, sub));
}

function size(item: FigNode | FigGroup, s: Sizes): { w: number; h: number } {
  if (!isGroup(item)) {
    const contents = s.cards.get(item.id);
    const w = nodeWidth(item, contents != null);
    const top = item.shape === 'store' ? 24 : 10;
    const card = contents ? 8 + s.cardH.get(item.id)! : 0;
    const h = Math.max(top + LABEL_LINE + (item.sub ? SUB_LINE : 0) + card + 10, s.minH(item.id));
    return item.shape === 'decision' ? { w: w + 70, h: h + 24 } : { w, h };
  }
  const kids = item.children.map((c) => size(c, s));
  const gap = s.gap(item);
  const along = kids.reduce((n, k) => n + (item.direction === 'column' ? k.h : k.w), 0) + gap * (kids.length - 1);
  const across = Math.max(...kids.map((k) => (item.direction === 'column' ? k.w : k.h)));
  const inner = item.direction === 'column' ? { w: across, h: along } : { w: along, h: across };
  return item.label != null ? { w: inner.w + FRAME_SIDE * 2, h: inner.h + FRAME_TOP + FRAME_BOTTOM } : inner;
}

function place(item: FigNode | FigGroup, x: number, y: number, s: Sizes, out: Placed[]): void {
  const { w, h } = size(item, s);
  out.push({ x, y, w, h, item });
  if (!isGroup(item)) return;
  const framed = item.label != null;
  let ix = x + (framed ? FRAME_SIDE : 0);
  let iy = y + (framed ? FRAME_TOP : 0);
  const innerW = w - (framed ? FRAME_SIDE * 2 : 0),
    innerH = h - (framed ? FRAME_TOP + FRAME_BOTTOM : 0);
  const gap = s.gap(item);
  for (const child of item.children) {
    const c = size(child, s);
    const align = item.align ?? 'center';
    const off = (room: number, used: number) => (align === 'start' ? 0 : align === 'end' ? room - used : (room - used) / 2);
    if (item.direction === 'column') {
      place(child, ix + off(innerW, c.w), iy, s, out);
      iy += c.h + gap;
    } else {
      place(child, ix, iy + off(innerH, c.h), s, out);
      ix += c.w + gap;
    }
  }
}

/** One stretch of the loop: the figure holds still, showing beat `bi` of step `si`. */
type Seg = { t0: number; t1: number; si: number; bi: number };

/** Options for `toSvg`, `render` and `check`. */
export type SvgOptions = {
  /** Milliseconds a packet takes to cross one edge, in place of `FlowProps.speed`. Default: `FlowProps.speed`, else 900. */
  speed?: number;
  /** Space around the figure in px. Default: 24. */
  padding?: number;
  /** Colors, in place of `FlowProps.theme`. Default: `FlowProps.theme`. */
  theme?: FigTheme;
};

const SYSTEM_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The SVG string, and the scene it drew. The scene lets `flowfig check` test the same layout the SVG uses.
 * The scene is for tools, and its shape may change. Use `toSvg` if you only need the SVG.
 */
export function render(fig: FlowProps, opts: SvgOptions = {}): { svg: string; scene: Scene } {
  const speed = (opts.speed ?? fig.speed ?? 900) / 1000 / BASE_RATE;
  const pad = opts.padding ?? 24;
  const steps = fig.steps ?? [];
  const beats: Beat[][] = steps.map((s) => s.flow.map(toBeat));

  // Every content a box will ever show, so its card can be sized to the biggest one up front.
  const cards = new Map<string, FigContent[]>();
  for (const b of beats.flat()) for (const [id, c] of Object.entries(b.show ?? {})) cards.set(id, [...(cards.get(id) ?? []), c]);

  // Boxes with many edges on one side get taller so the edges and their labels have room.
  const out: Record<string, number> = {},
    inn: Record<string, number> = {};
  for (const e of fig.edges) {
    out[e.from] = (out[e.from] ?? 0) + 1;
    inn[e.to] = (inn[e.to] ?? 0) + 1;
  }
  const minH = (id: string) => {
    const n = Math.max(out[id] ?? 0, inn[id] ?? 0);
    return n > 2 ? n * 30 : 0;
  };
  const cardH = new Map<string, number>();
  const sizes: Sizes = { cards, cardH, minH, gap: (g) => groupGap(g, fig.edges) };
  for (const [id, contents] of cards) {
    const width = CARD_WIDTH; // refined below once the node's own width is known
    const widths = [width];
    cardH.set(id, Math.max(LINE + CARD_PAD * 2, ...contents.map((c) => layoutCard(c, Math.min(...widths) - 20).height)));
  }

  const placed: Placed[] = [];
  place(fig.layout, pad, pad, sizes, placed);
  const nodes = placed.filter((p) => !isGroup(p.item)) as (Rect & { item: FigNode })[];
  // A node's own width can differ from CARD_WIDTH (`width` in the spec), so re-measure once placed.
  for (const p of nodes) {
    if (!cards.has(p.item.id)) continue;
    const inner = p.w - 20;
    cardH.set(p.item.id, Math.max(...cards.get(p.item.id)!.map((c) => layoutCard(c, inner).height), LINE + CARD_PAD * 2));
  }
  placed.length = 0;
  place(fig.layout, pad, pad, sizes, placed);

  const rects: Record<string, Rect> = {};
  for (const p of placed) if (p.item.id) rects[p.item.id] = p;
  const tips = new Set(placed.filter((p) => !isGroup(p.item) && p.item.shape === 'decision').map((p) => p.item.id!));
  const ids = fig.edges.map(edgeId);
  const routed = route(
    fig.edges.map((e, i) => ({ id: ids[i], from: e.from, to: e.to, around: e.around })),
    rects,
    tips,
  );
  const byId = Object.fromEntries(routed.map((r) => [r.id, r]));

  // What this layout drew, in scene form. Tags are left out of minFont: short bold capitals, not reading text.
  const fonts = [14, ...(steps.length ? [13.5] : [])];
  const sceneBoxes: SceneBox[] = nodes.map((p) => {
    const room = (p.item.shape === 'decision' ? p.w - 70 : p.w) - 16;
    const texts: SceneBox['texts'] = [{ text: str(p.item.label), fontSize: 14, room }];
    if (p.item.sub) {
      texts.push({ text: str(p.item.sub), fontSize: 12, room });
      fonts.push(12);
    }
    for (const c of cards.get(p.item.id) ?? [])
      for (const r of layoutCard(c, p.w - 20).rows) {
        const fontSize = r.row.mono ? 10.5 : 11;
        fonts.push(fontSize);
        for (const line of r.lines) texts.push({ text: line, fontSize, room: r.room, mono: r.row.mono });
      }
    return { id: p.item.id, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, texts };
  });
  if (placed.some((p) => isGroup(p.item) && p.item.label != null)) fonts.push(11);

  // The timeline: every beat of every step, in order, with the player's hold at the end of each step.
  const segs: Seg[] = [];
  const hops: {
    si: number;
    bi: number;
    lane: number;
    edge: string;
    dest: string;
    back: boolean;
    data?: unknown;
    tone?: string;
    t0: number;
    t1: number;
    tEnd: number;
  }[] = [];
  const edgeOf = Object.fromEntries(fig.edges.map((e, i) => [ids[i], e]));
  let t = 0;
  beats.forEach((stepBeats, si) => {
    stepBeats.forEach((b, bi) => {
      const last = bi === stepBeats.length - 1;
      const dur = beatMs(b, opts.speed ?? fig.speed ?? 900) / 1000 / BASE_RATE;
      const hold = last ? STEP_HOLD_MS / 1000 / BASE_RATE : 0;
      b.hops.forEach((h, lane) => {
        if (byId[h.edge])
          hops.push({
            si,
            bi,
            lane,
            edge: h.edge,
            dest: h.back ? edgeOf[h.edge].from : edgeOf[h.edge].to,
            back: h.back,
            data: h.data,
            tone: h.tone && TONES[h.tone],
            t0: t,
            t1: t + speed,
            tEnd: t + dur,
          });
      });
      segs.push({ t0: t, t1: t + dur + hold, si, bi });
      t += dur + hold;
    });
  });
  const total = t || 1;

  // What the figure shows during each segment, matching the React player exactly.
  const shownAt = segs.map(
    ({ si, bi }) => Object.assign({}, ...beats[si].slice(0, bi + 1).map((b) => b.show)) as Record<string, FigContent>,
  );
  const litEdges = segs.map(({ si, bi }) => new Set(beats[si].slice(0, bi + 1).flatMap((b) => b.hops.map((h) => h.edge))));
  const litNodes = segs.map((seg, i) => {
    const on = new Set<string>([...(steps[seg.si].nodes ?? []), ...Object.keys(shownAt[i]), ...(beats[seg.si][seg.bi].light ?? [])]);
    fig.edges.forEach((e, ei) => {
      if (litEdges[i].has(ids[ei])) on.add(e.from).add(e.to);
    });
    return on;
  });
  const captions = segs.map(({ si, bi }) => {
    const said = beats[si].slice(0, bi + 1).findLastIndex((b) => b.say != null);
    return str(said === -1 ? steps[si].caption : beats[si][said].say);
  });

  // One class per on/off pattern over the segments, so 30 boxes share a handful of keyframes.
  const css: string[] = [];
  const seen = new Map<string, string>();
  /** The class that switches this element between `onCss` and `offCss` as the loop plays. */
  const anim = (on: boolean[], onCss: string, offCss: string, prefix: string): string => {
    if (!segs.length || on.every((x) => !x)) return '';
    const key = prefix + on.map((x) => (x ? 1 : 0)).join('');
    if (!seen.has(key)) {
      const name = `a${seen.size}`;
      seen.set(key, name);
      const frames = segs.map((s, i) => `${pct(s.t0 / total)},${pct(s.t1 / total - 0.0001)} { ${on[i] ? onCss : offCss} }`).join(' ');
      css.push(`@keyframes ${name} { ${frames} }\n.${name} { animation: ${name} ${n2(total)}s infinite step-end; }`);
    }
    return seen.get(key)!;
  };
  /** One `class` attribute from the static classes and the animated one — two would be invalid XML. */
  const cls = (...names: (string | false | undefined)[]) => {
    const list = names.filter(Boolean).join(' ');
    return list ? ` class="${list}"` : '';
  };

  /** Like `anim`, for a property that takes a different value in each segment (a row that moves as phases fold). */
  const frames = (values: string[], prefix: string, base = values[0]): string => {
    if (!segs.length || values.every((v) => v === base)) return '';
    const key = prefix + values.join('|');
    if (!seen.has(key)) {
      const name = `a${seen.size}`;
      seen.set(key, name);
      const kf = segs.map((s, i) => `${pct(s.t0 / total)},${pct(s.t1 / total - 0.0001)} { ${values[i]} }`).join(' ');
      css.push(`@keyframes ${name} { ${kf} }\n.${name} { animation: ${name} ${n2(total)}s infinite step-end; }`);
    }
    return seen.get(key)!;
  };

  /**
   * The look of one box over the loop: off, trail (visited) or active (the packet arrived, until the segment ends).
   * A segment ends at the beat end, or after the step hold for the last beat.
   * Each frame holds one look. The gap before the frame that follows an active frame gives the FADE.
   * FADE is in timeline seconds, which are wall seconds.
   */
  const FADE = 0.4;
  // A box tone is a permanent state: a 1 px border and a light tint in the off and trail looks. The active look uses the hop tone, else the box tone.
  const looks = (look: 'off' | 'trail' | 'active', boxTone?: string, hopTone?: string) => {
    const tint = boxTone ? toneTint(boxTone, 'var(--bg)') : 'var(--bg)';
    if (look === 'off') return [tint, boxTone ?? 'var(--border)', 1, 'drop-shadow(0 0 0 transparent)'] as const;
    if (look === 'trail') return [tint, boxTone ?? 'var(--accent)', 1, 'drop-shadow(0 0 0 transparent)'] as const;
    const c = hopTone ?? boxTone;
    return c
      ? ([toneTint(c, 'var(--surface)', 10), c, 2, `drop-shadow(0 0 4px ${c})`] as const)
      : (['var(--tint)', 'var(--accent)', 2, 'drop-shadow(0 0 4px var(--accent))'] as const);
  };
  const boxAnim = (id: string, shape: boolean, boxTone?: string): string => {
    const pieces: { a: number; b: number; look: 'off' | 'trail' | 'active'; hop?: string; ramp?: number }[] = [];
    segs.forEach((s, i) => {
      if (!litNodes[i].has(id)) return void pieces.push({ a: s.t0, b: s.t1, look: 'off' });
      const here = hops.filter((h) => h.dest === id && h.si === s.si && h.bi === s.bi);
      const arrive = Math.min(...here.map((h) => h.t1), s.t1);
      if (arrive > s.t0) pieces.push({ a: s.t0, b: arrive, look: 'trail' });
      if (arrive < s.t1) pieces.push({ a: arrive, b: s.t1, look: 'active', hop: here.find((h) => h.tone)?.tone });
    });
    if (!pieces.length || pieces.every((q) => q.look === 'off')) return '';
    // The last frame is active: the fade ends at 100 %, so the loop wraps with no jump.
    const end = pieces.at(-1)!;
    if (end.look === 'active') {
      end.b -= FADE;
      pieces.push({ a: end.b, b: end.b + FADE, look: pieces[0].look, hop: pieces[0].hop, ramp: FADE - 0.0002 * total });
    }
    const kf = pieces.map((q, k) => {
      const ramp = q.ramp ?? (q.look !== 'active' && pieces[k - 1]?.look === 'active' ? Math.min(FADE, (q.b - q.a) / 2) : 0);
      const [fill, stroke, width, filter] = looks(q.look, boxTone, q.hop);
      const css = `${shape ? `fill: ${fill}; ` : ''}stroke: ${stroke}; stroke-width: ${width}${shape ? `; filter: ${filter}` : ''}`;
      return `${pct((q.a + ramp) / total)},${pct(q.b / total - 0.0001)} { ${css} }`;
    });
    const key = (shape ? 'B' : 'R') + kf.join(' ');
    if (!seen.has(key)) {
      const name = `a${seen.size}`;
      seen.set(key, name);
      css.push(`@keyframes ${name} { ${kf.join(' ')} }\n.${name} { animation: ${name} ${n2(total)}s infinite linear; }`);
    }
    return seen.get(key)!;
  };

  const boxes = placed.map((p) => {
    const { item } = p;
    if (isGroup(item)) {
      if (item.label == null) return '';
      const on = item.id ? segs.map((_, i) => litNodes[i].has(item.id!)) : [];
      return (
        `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" rx="14" fill="var(--surface)" stroke="var(--border)"` +
        cls(anim(on, 'stroke: var(--accent)', 'stroke: var(--border)', 'n')) +
        `/><text x="${n2(p.x + FRAME_SIDE)}" y="${n2(p.y + 20)}" class="frame">${esc(str(item.label).toUpperCase())}</text>`
      );
    }
    const bt = item.tone && TONES[item.tone];
    const stroke = cls(boxAnim(item.id, true, bt));
    const rim = item.shape === 'store' ? cls(boxAnim(item.id, false, bt)) : '';
    const fill0 = bt ? toneTint(bt, 'var(--bg)') : 'var(--bg)';
    const stroke0 = bt ?? 'var(--border)';
    const cx = p.x + p.w / 2;
    const contents = cards.get(item.id);
    const cardTop = p.y + p.h - 10 - (contents ? cardH.get(item.id)! : 0);
    const labelY = item.shape === 'store' ? p.y + 24 + 13 : contents ? p.y + 10 + 13 : p.y + p.h / 2 + (item.sub ? -2 : 5);
    const shape =
      item.shape === 'decision'
        ? `<polygon points="${n2(cx)},${n2(p.y)} ${n2(p.x + p.w)},${n2(p.y + p.h / 2)} ${n2(cx)},${n2(p.y + p.h)} ${n2(p.x)},${n2(p.y + p.h / 2)}" fill="${fill0}" stroke="${stroke0}"${stroke}/>`
        : item.shape === 'store'
          ? `<path d="M${n2(p.x)} ${n2(p.y + 12)} a ${n2(p.w / 2)} 12 0 0 1 ${n2(p.w)} 0 v ${n2(p.h - 24)} a ${n2(p.w / 2)} 12 0 0 1 ${n2(-p.w)} 0 z" fill="${fill0}" stroke="${stroke0}"${stroke}/>` +
            `<path d="M${n2(p.x)} ${n2(p.y + 12)} a ${n2(p.w / 2)} 12 0 0 0 ${n2(p.w)} 0" fill="none" stroke="${stroke0}"${rim}/>`
          : `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" rx="10" fill="${fill0}" stroke="${stroke0}"${stroke}/>`;
    const label = `<text x="${n2(cx)}" y="${n2(labelY)}" class="label">${esc(str(item.label))}</text>`;
    const sub = item.sub ? `<text x="${n2(cx)}" y="${n2(labelY + SUB_LINE)}" class="sub">${esc(str(item.sub))}</text>` : '';
    return shape + label + sub + (contents ? card(p as Rect & { item: FigNode }, cardTop, contents) : '');
  });

  /** The dashed content card: one group per content it will ever hold, each visible on its own beats. */
  function card(p: Rect & { item: FigNode }, top: number, contents: FigContent[]): string {
    const id = p.item.id;
    const x = p.x + 10,
      w = p.w - 20,
      h = cardH.get(id)!;
    const filled = segs.map((_, i) => shownAt[i][id] != null);
    const box =
      `<rect x="${n2(x)}" y="${n2(top)}" width="${n2(w)}" height="${n2(h)}" rx="6" fill="var(--surface)" stroke="var(--border)" stroke-dasharray="3 3"` +
      cls(anim(filled, 'stroke: var(--accent); fill: var(--card-on)', 'stroke: var(--border); fill: var(--surface)', 'c')) +
      `/>`;
    // Every distinct content gets a layer; the segments decide which one is showing.
    const layers = contents
      .map((c, ci) => {
        const on = segs.map((_, i) => contents.indexOf(shownAt[i][id] as FigContent) === ci);
        if (on.every((x) => !x)) return '';
        return `<g opacity="0"${cls(anim(on, 'opacity: 1', 'opacity: 0', 'v'))}>${rows(c, x, top, w)}</g>`;
      })
      .join('');
    const empty = segs.map((_, i) => shownAt[i][id] == null);
    const dash = empty.some(Boolean)
      ? `<text x="${n2(x + CARD_SIDE)}" y="${n2(top + CARD_PAD + 11)}" opacity="0"${cls('row', 'muted', anim(empty, 'opacity: 1', 'opacity: 0', 'v'))}>—</text>`
      : '';
    return box + layers + dash;
  }

  /** One card's rows: a colored tag pill, the text, its muted meta, and the mark on the right. */
  function rows(c: FigContent, x: number, top: number, w: number): string {
    const { rows } = layoutCard(c, w);
    let y = top + CARD_PAD;
    return rows
      .map(({ row, heads, lines }) => {
        const tone = TONES[row.tone ?? 'blue'];
        const left = x + CARD_SIDE;
        const parts: string[] = [];
        const tagW = row.tag ? pillW(row.tag) : 0;
        const pill = (px: number, py: number) =>
          row.tag
            ? `<rect x="${n2(px)}" y="${n2(py)}" width="${n2(tagW)}" height="14" rx="4" fill="${tone}" fill-opacity="0.15"/>` +
              `<text x="${n2(px + tagW / 2)}" y="${n2(py + 10.5)}" class="tag" fill="${tone}">${esc(row.tag.toUpperCase())}</text>`
            : '';
        const mark = row.mark ? `<text x="${n2(x + w - CARD_SIDE)}" y="${n2(y + 11)}" class="mark">${esc(str(row.mark))}</text>` : '';
        if (heads) {
          parts.push(pill(left, y + 1), mark);
          y += LINE;
        }
        const indent = heads ? 0 : tagW ? tagW + 5 : 0;
        if (!heads) parts.push(pill(left, y + 1), mark);
        lines.forEach((line, li) => {
          parts.push(
            `<text x="${n2(left + (li === 0 ? indent : 0))}" y="${n2(y + 11)}"${cls('row', row.mono && 'mono')}>${esc(line)}</text>`,
          );
          y += LINE;
        });
        y += ROW_GAP;
        return parts.join('');
      })
      .join('');
  }

  const labelRects: Record<string, Rect> = {};
  const edgeSvg = routed.map((r) => {
    const e = fig.edges[ids.indexOf(r.id)];
    const on = segs.map((_, i) => litEdges[i].has(r.id));
    const hidden = e.quiet && !on.every(Boolean);
    const shown = hidden ? cls(anim(on, 'opacity: 1', 'opacity: 0', 'q')) : '';
    // A toned hop colors its edge for its own beat only; the trail after it is the accent.
    const tone = segs.map(
      ({ si, bi }) => (beats[si][bi].hops.find((h) => h.edge === r.id && h.tone)?.tone ?? undefined) as FigTone | undefined,
    );
    const col = tone.map((x) => (x ? TONES[x] : 'var(--accent)'));
    const off = `stroke: var(--muted); stroke-width: ${EDGE_OFF}`;
    // With no tone the map and the rail share one keyframe (same key); a toned edge needs its own values.
    const toned = tone.some(Boolean);
    const lit = cls(
      toned
        ? frames(
            on.map((x, i) => (x ? `stroke: ${col[i]}; stroke-width: ${EDGE_ON}` : off)),
            'e',
            off,
          )
        : anim(on, `stroke: var(--accent); stroke-width: ${EDGE_ON}`, off, 'e'),
    );
    const path = `<path id="p-${esc(r.id)}" d="${r.d}" fill="none" stroke="var(--muted)" stroke-width="${EDGE_OFF}" marker-end="url(#arrow)"${lit}/>`;
    // A quiet edge is only drawn while a step uses it, so wrap the whole thing rather than the stroke.
    const label =
      e.label == null
        ? ''
        : (() => {
            const lw = labelPillW(str(e.label));
            labelRects[r.id] = { x: r.mid.x - lw / 2, y: r.mid.y - 9, w: lw, h: 18 };
            fonts.push(11);
            return (
              `<rect x="${n2(r.mid.x - lw / 2)}" y="${n2(r.mid.y - 9)}" width="${n2(lw)}" height="18" rx="9" fill="var(--bg)" stroke="var(--border)"` +
              cls(
                toned
                  ? frames(
                      on.map((x, i) =>
                        x ? `fill: ${tone[i] ? toneFill(col[i]) : col[i]}; stroke: ${col[i]}` : 'fill: var(--bg); stroke: var(--border)',
                      ),
                      'l',
                      'fill: var(--bg); stroke: var(--border)',
                    )
                  : anim(on, 'fill: var(--accent); stroke: var(--accent)', 'fill: var(--bg); stroke: var(--border)', 'l'),
              ) +
              `/><text x="${n2(r.mid.x)}" y="${n2(r.mid.y + 4)}"${cls('edgelabel', anim(on, `fill: ${ON_ACCENT}`, 'fill: var(--muted)', 'x'))}>${esc(str(e.label))}</text>`
            );
          })();
    return hidden ? `<g opacity="0"${shown}>${path}${label}</g>` : path + label;
  });

  // A packet per hop: it waits offstage, crosses its edge in `speed`, rests at the end of the edge to the end of its beat, then leaves. Any `data`
  // rides above it in a chip, which is how the figure says what is moving.
  const packets = hops.map((h, i) => {
    const t0 = h.t0 / total,
      t1 = h.t1 / total,
      tEnd = h.tEnd / total;
    const name = `p${i}`;
    css.push(
      `@keyframes ${name} { 0%,${pct(t0)} { opacity: 0 } ${pct(t0 + 0.0001)},${pct(tEnd - 0.0001)} { opacity: 1 } ${pct(tEnd)},100% { opacity: 0 } }\n` +
        `.${name} { animation: ${name} ${n2(total)}s infinite step-end; }`,
    );
    const chip = (() => {
      const label = str(h.data);
      if (!label) return '';
      fonts.push(11.5);
      const lines = wrap(label, 210, 11.5);
      const w = Math.max(...lines.map((l) => textWidth(l, 11.5))) + 18;
      const boxH = lines.length * 15 + 8;
      return (
        `<rect x="${n2(-w / 2)}" y="${n2(-boxH - 12)}" width="${n2(w)}" height="${n2(boxH)}" rx="8" fill="${h.tone ? toneFill(h.tone) : 'var(--accent)'}"/>` +
        lines.map((l, li) => `<text x="0" y="${n2(-boxH - 12 + 15 * li + 15)}" class="chip">${esc(l)}</text>`).join('')
      );
    })();
    return (
      `<g${cls(name)} opacity="0"><circle r="10" fill="${h.tone ?? 'var(--accent)'}" opacity="0.2"/><circle r="4.5" fill="${h.tone ?? 'var(--accent)'}"/>${chip}` +
      `<animateMotion dur="${n2(total)}s" repeatCount="indefinite" keyTimes="0;${n4(t0)};${n4(t1)};1" keyPoints="${h.back ? '1;1;0;0' : '0;0;1;1'}" calcMode="linear">` +
      `<mpath href="#p-${esc(h.edge)}" xlink:href="#p-${esc(h.edge)}"/></animateMotion></g>`
    );
  });

  const bounds = placed[0];
  const arcs = fig.edges.some((e) => e.around);
  const capLines = [...new Set(captions)].flatMap((c) => wrap(c, Math.max(560, bounds.w), 13.5).length);
  const mapW = Math.max(bounds.w + pad * 2, 560);
  // `rail: 'only'` drops the map, but only when the rail has a hop to draw; a figure never renders empty.
  const rail: Rail | null = fig.rail ? layoutRail(fig, fig.rail === 'only' ? 560 : mapW) : null;
  const only = fig.rail === 'only' && rail != null;
  // With the rail, the rail shows the step label, so the caption holds the narration only.
  const capTop = rail ? 20 : 26;
  const capH = steps.length ? capTop + 4 + Math.max(0, ...capLines) * 20 : 0;
  const W = only ? Math.max(560, rail.width) : Math.max(mapW, rail?.width ?? 0);
  const mapH = only ? 0 : bounds.h + pad * 2 + (arcs ? 44 : 0);
  const top = only ? pad : mapH + RAIL.gap; // the rail's top
  const H = only ? pad + rail.height + capH : mapH + (rail ? RAIL.gap + rail.height : 0) + capH;
  const shift = (W - (bounds.w + pad * 2)) / 2;
  const railX = rail ? (W - rail.width) / 2 : 0;

  // The step label and its narration, both switching with the beats.
  const labels = rail
    ? []
    : steps.map((_, si) => {
        const on = segs.map((s) => s.si === si);
        return `<text x="${n2(W / 2)}" y="${n2(H - capH + 16)}" opacity="0"${cls('steplabel', anim(on, 'opacity: 1', 'opacity: 0', 's'))}>${esc(str(steps[si].label))}</text>`;
      });
  const said = [...new Set(captions)].map((text) => {
    const on = captions.map((c) => c === text);
    const lines = wrap(text, Math.max(560, bounds.w), 13.5);
    return (
      `<g opacity="0"${cls(anim(on, 'opacity: 1', 'opacity: 0', 'y'))}>` +
      lines.map((l, li) => `<text x="${n2(W / 2)}" y="${n2(H - capH + capTop + 16 + li * 20)}" class="caption">${esc(l)}</text>`).join('') +
      `</g>`
    );
  });

  // The rail: lifelines under the map. Every part reuses a map part: the frame for a band, the edge-label pill for a payload, the card
  // tag for `async`, the filled card for a parallel group. So the rail adds no color and no font size.
  const railSvg = !rail
    ? ''
    : (() => {
        const parts: string[] = [];
        const cols = rail.head - RAIL.cols / 2 + 4; // the column-label baseline
        for (const b of rail.bands)
          parts.push(
            `<rect x="${n2(b.rect.x)}" y="${n2(top + b.rect.y)}" width="${n2(b.rect.w)}" height="${n2(b.rect.h)}" rx="10" fill="var(--surface)" stroke="var(--border)"/>` +
              `<text x="${n2(b.rect.x + 10)}" y="${n2(top + b.rect.y + 14)}" class="frame">${esc(b.label.toUpperCase())}</text>`,
          );
        for (const c of rail.columns) parts.push(`<text x="${n2(c.x)}" y="${n2(top + cols)}" class="railcol">${esc(c.label)}</text>`);
        // Where each row sits in each segment: it moves when another phase opens, and hides while its phase is folded.
        const at = (i: number) => segs.map((s) => railState(rail, s.si)[i]);
        const base = (i: number) => railState(rail, 0)[i].y;
        const moveRow = (i: number) =>
          frames(
            at(i).map((st) => `transform: translateY(${n2(st.y - base(i))}px); opacity: ${st.shown ? 1 : 0}`),
            'm',
          );
        // The lifelines run through the message rows only, so a phase header reads as one clear divider.
        rail.rows.forEach((row, i) => {
          if (row.kind !== 'message') return;
          const y = top + base(i);
          const d = rail.columns.map((c) => `M ${n2(c.x)} ${n2(y)} V ${n2(y + RAIL.row)}`).join(' ');
          parts.push(`<g${cls(moveRow(i))}><path d="${d}" stroke="var(--border)" stroke-dasharray="2 3"/></g>`);
        });
        rail.groups.forEach((g) => {
          const box = groupBox(rail, g);
          const y = top + base(g.rows[0]);
          parts.push(
            `<g${cls(moveRow(g.rows[0]))}><rect x="${n2(box.x)}" y="${n2(y + box.y)}" width="${n2(box.w)}" height="${n2(box.h)}" rx="6" fill="var(--card-on)" stroke="var(--accent)" stroke-dasharray="3 3"/></g>`,
          );
        });
        rail.rows.forEach((row, i) => {
          const y = top + base(i);
          if (row.kind === 'phase') {
            const folded = segs.map((s) => rail.folds && s.si !== row.step);
            const rule = (x1: number) => `<path d="M ${n2(x1)} ${n2(y + 15)} H ${n2(row.line.end)}" stroke="var(--border)"/>`;
            // One counter per beat of this phase, on this row, so it moves with the row. A parallel beat counts its first message.
            const first = new Map<number, number>(); // beat -> the n of its first message
            for (const r of rail.rows) if (r.kind === 'message' && r.step === row.step && !first.has(r.beat)) first.set(r.beat, r.n);
            const counters = [...first].map(([beat, n]) => {
              const now = segs.map((s) => s.si === row.step && s.bi === beat);
              return `<text x="${n2(rail.width - RAIL.pad)}" y="${n2(y + 19)}" opacity="0"${cls('frame', 'end', anim(now, 'opacity: 1', 'opacity: 0', 'c'))}>${n} of ${rail.total}</text>`;
            });
            parts.push(
              `<g${cls(moveRow(i))}>` +
                `<g${cls(anim(folded, 'opacity: 0', 'opacity: 1', 'o'))}><text x="${n2(RAIL.pad)}" y="${n2(y + 19)}" class="railphase">${esc(row.label)}</text>${rule(row.line.open)}</g>` +
                (rail.folds
                  ? `<g opacity="0"${cls(anim(folded, 'opacity: 1', 'opacity: 0', 'f'))}><text x="${n2(RAIL.pad)}" y="${n2(y + 19)}" class="railphase muted">${esc(foldedLabel(row))}</text>${rule(row.line.folded)}</g>`
                  : '') +
                counters.join('') +
                `</g>`,
            );
            return;
          }
          const now = segs.map((s) => s.si === row.step && s.bi === row.beat);
          const next = segs.map((s) => s.si < row.step || (s.si === row.step && s.bi < row.beat));
          const [x1, x2] = [rail.columns[row.from].x, rail.columns[row.to].x];
          const ly = y + RAIL.row / 2;
          const col = row.tone ? TONES[row.tone] : 'var(--accent)';
          const lit = anim(
            now,
            `stroke: ${col}; stroke-width: ${EDGE_ON}`,
            `stroke: var(--muted); stroke-width: ${EDGE_OFF}`,
            row.tone ? 'e' + col : 'e',
          );
          const tagW = ASYNC_TAG_W;
          // The tag sits on the tail side of the pill, so it never hides the arrowhead.
          const tagX = !row.pill ? (x1 + x2) / 2 - tagW / 2 : x2 > x1 ? row.pill.x - tagW - 4 : row.pill.x + row.pill.w + 4;
          const tag = row.async
            ? `<rect x="${n2(tagX)}" y="${n2(ly - 6)}" width="${n2(tagW)}" height="12" rx="4" fill="var(--bg)"/>` +
              `<rect x="${n2(tagX)}" y="${n2(ly - 6)}" width="${n2(tagW)}" height="12" rx="4" fill="${TONES.gray}" fill-opacity="0.15"/>` +
              `<text x="${n2(tagX + tagW / 2)}" y="${n2(ly + 3)}" class="tag" fill="${TONES.gray}">ASYNC</text>`
            : '';
          const pill = row.pill
            ? `<rect x="${n2(row.pill.x)}" y="${n2(ly - 9)}" width="${n2(row.pill.w)}" height="18" rx="9" fill="var(--bg)" stroke="var(--border)"${cls(anim(now, `fill: ${row.tone ? toneFill(col) : col}; stroke: ${col}`, 'fill: var(--bg); stroke: var(--border)', row.tone ? 'l' + col : 'l'))}/>` +
              `<text x="${n2(row.pill.x + row.pill.w / 2)}" y="${n2(ly + 4)}"${cls('edgelabel', anim(now, `fill: ${ON_ACCENT}`, 'fill: var(--muted)', 'x'))}>${esc(row.text)}</text>`
            : '';
          parts.push(
            `<g${cls('railrow', moveRow(i))}><g${cls(anim(next, 'opacity: .45', 'opacity: 1', 'r'))}>` +
              `<path d="M ${n2(x1)} ${n2(ly)} H ${n2(x2)}" fill="none" stroke="var(--muted)" stroke-width="${EDGE_OFF}"${row.async ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#arrow)"${cls(lit)}/>` +
              tag +
              pill +
              `</g></g>`,
          );
        });
        return `<g transform="translate(${n2(railX)} 0)">${parts.join('')}</g>`;
      })();

  const { font, ...t0 } = { ...LIGHT, ...fig.theme, ...opts.theme };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(W)}" height="${n2(H)}" viewBox="0 0 ${n2(W)} ${n2(H)}" font-family="${esc(font ?? SYSTEM_FONT)}">
<style>
svg { ${vars(t0, '#eef5fd')} }
@media (prefers-color-scheme: dark) { svg { ${vars(DARK, '#1d2733')} } }
.label { fill: var(--fg); font-size: 14px; font-weight: 500; text-anchor: middle; }
.sub { fill: var(--muted); font-size: 12px; text-anchor: middle; }
.frame { fill: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .04em; }
.edgelabel { fill: var(--muted); font-size: 11px; text-anchor: middle; font-family: ui-monospace, Menlo, monospace; }
.row { fill: var(--fg); font-size: 11px; }
.row.mono { font-size: 10.5px; font-family: ui-monospace, Menlo, monospace; }
.muted { fill: var(--muted); }
.tag { font-size: 9px; font-weight: 600; letter-spacing: .03em; text-anchor: middle; }
.mark { fill: var(--accent); font-size: 11px; font-weight: 600; text-anchor: end; }
.chip { fill: ${ON_ACCENT}; font-size: 11.5px; text-anchor: middle; }
.steplabel { fill: var(--fg); font-size: 13px; font-weight: 600; text-anchor: middle; font-family: ui-monospace, Menlo, monospace; }
.caption { fill: var(--muted); font-size: 13.5px; text-anchor: middle; }
.railcol { fill: var(--fg); font-size: 12px; font-weight: 500; text-anchor: middle; }
.railphase { fill: var(--fg); font-size: 13px; font-weight: 600; font-family: ui-monospace, Menlo, monospace; }
.railphase.muted { fill: var(--muted); }
.end { text-anchor: end; }
${css.join('\n')}
</style>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke"/></marker></defs>
<rect width="100%" height="100%" fill="var(--bg)"/>
${
  only
    ? ''
    : `<g transform="translate(${n2(shift)} ${arcs ? 44 : 0})">
${boxes.filter(Boolean).join('\n')}
${edgeSvg.join('\n')}
${packets.join('\n')}
</g>
`
}${railSvg}
${labels.join('\n')}
${said.join('\n')}
</svg>
`;
  if (rail) fonts.push(12, 13);
  const scene: Scene = {
    width: n2(W),
    boxes: only ? [] : sceneBoxes,
    edges: [
      ...(only ? [] : routed).map((r) => {
        const e = fig.edges[ids.indexOf(r.id)];
        return { id: r.id, from: e.from, to: e.to, curve: r.curve, label: labelRects[r.id] };
      }),
      // Each rail payload is a label too, in its own open-phase position, so label-overlap covers the rail.
      ...(rail?.rows ?? []).flatMap((row, i) => {
        if (row.kind !== 'message') return [];
        // Scene coordinates are the map's layout coordinates: the page minus the map's translate(shift, arcs).
        const dx = only ? railX : railX - shift,
          dy = only ? top : top - (arcs ? 44 : 0);
        const y = dy + railState(rail!, row.step)[i].y + RAIL.row / 2;
        const [x1, x2] = [dx + rail!.columns[row.from].x, dx + rail!.columns[row.to].x];
        const p = { x: x1, y },
          q = { x: x2, y };
        return [
          {
            id: `rail:${row.n}`,
            step: row.step,
            from: rail!.columns[row.from].id,
            to: rail!.columns[row.to].id,
            curve: [p, p, q, q] as [Pt, Pt, Pt, Pt],
            label: row.pill && { x: dx + row.pill.x, y: y - 9, w: row.pill.w, h: 18 },
          },
        ];
      }),
    ],
    minFont: Math.min(...fonts),
  };
  return { svg, scene };
}

/** One self-contained animated SVG string for the figure. Needs no React and no browser. */
export function toSvg(fig: FlowProps, opts: SvgOptions = {}): string {
  return render(fig, opts).svg;
}

/** Every fault `flowfig check` knows about, for this figure as the SVG lays it out. A `Finding` has a `rule` name, a `severity`, the ids it names and a message. */
export function check(fig: FlowProps, opts: SvgOptions & CheckOptions = {}): Finding[] {
  return [...checkSpec(fig), ...checkScene(render(fig, opts).scene, opts), ...checkTheme({ ...fig.theme, ...opts.theme })];
}
