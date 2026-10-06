// Wrapping is approximate: text is measured by character class, not by a browser.
import { arcRoom, avoidOf, route, type Pt, type Rect, type Side } from './geometry.ts';
import { foldedLabel, groupBox, layoutRail, railState, RAIL, type Rail } from './rail.ts';
import { textWidth, wrap } from './text.ts';
import { checkRendered, planFor, type CheckOptions } from './check.ts';
import type { Finding, Scene, SceneBox, SceneEdge } from './scene.ts';
import { autoLayout } from './auto.ts';
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
  LANE_PAD,
  LANE_ROW_GAP,
  LANE_BLOCK_GAP,
  FRAME_SIDE,
  laneGutter as gutterOf,
  STUB_ROOM,
  laneBlock,
  laneEnd,
  tightCopies,
  type LanePlan,
  LABEL_LINE,
  itemWidth,
  labelLines,
  fitCap,
  diamondLines,
  diamondRoom,
  isLanesLayout,
  timelineBeats,
  timelineLayout,
  TL_AXIS_H,
  TL_AXIS_W,
  TL_BAR_H,
  TL_ROW_GAP,
  toBeat,
  altText,
  beatMs,
  STEP_HOLD_MS,
  playheadItem,
  loopStartItem,
  dateLabelRaised,
  labelSpan,
  outsideLabelRect,
  type Beat,
  type FigContent,
  type FigGroup,
  type FigNode,
  type FigRow,
  type FigTheme,
  type FigTone,
  type FlowProps,
  edgeTip,
} from './model.ts';

export { LIGHT, DARK } from './model.ts';

const LINE = CARD_LINE,
  CARD_SIDE = 8,
  ROW_GAP = 4;
const SUB_LINE = 15;
const FRAME_TOP = 37,
  FRAME_BOTTOM = 18;

// The card-on fills approximate the player's 8 % accent tint.
const vars = (t: Record<'accent' | 'fg' | 'muted' | 'bg' | 'surface' | 'border', string>, cardOn: string) =>
  `--accent:${t.accent}; --fg:${t.fg}; --muted:${t.muted}; --bg:${t.bg}; --surface:${t.surface}; --border:${t.border}; --card-on:${cardOn}; --tint:color-mix(in srgb, var(--accent) 10%, var(--surface));`;

const content = (c: FigContent): FigRow[] | string => (isRows(c) ? c : str(c));
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const n2 = (v: number) => Math.round(v * 10) / 10;
// Four decimals: one decimal rounds a 0.7 s hop away and the packet jumps.
const n4 = (v: number) => Math.round(v * 10000) / 10000;
const pct = (v: number) => Math.round(v * 10000) / 100 + '%';

const pillW = (tag: string) => textWidth(tag.toUpperCase(), 9) + tag.length * 0.27 + 8;

type Row = { row: FigRow; heads: boolean; lines: string[]; room: number };
function layoutCard(c: FigContent, width: number): { rows: Row[]; height: number } {
  const inner = width - CARD_SIDE * 2;
  if (c == null) return { rows: [], height: LINE + CARD_PAD * 2 };
  const body = content(c);
  if (!Array.isArray(body)) {
    const lines = wrap(body || ' ', inner, 11);
    return { rows: [{ row: { text: body }, heads: false, lines, room: inner }], height: lines.length * LINE + CARD_PAD * 2 };
  }
  const rows = body.map((row) => {
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

type Placed = Rect & { item: FigNode | FigGroup; lane?: true; block?: number; tl?: { milestone: boolean; labelInside: boolean } };
type Sizes = {
  cards: Map<string, FigContent[]>;
  cardH: Map<string, number>;
  minH: (id: string) => number;
  gap: (g: FigGroup) => number;
  fig: FlowProps;
  plan: LanePlan | null;
  tall: Set<string>;
  cap: number;
};

function size(item: FigNode | FigGroup, s: Sizes): { w: number; h: number } {
  if (!isGroup(item)) {
    const contents = s.cards.get(item.id);
    const w = itemWidth(item, s.cards, s.fig.edges, s.cap);
    const top = item.shape === 'store' ? 24 : 10;
    const card = contents ? 8 + s.cardH.get(item.id)! : 0;
    const label = labelLines(item, w).length * LABEL_LINE;
    const h = Math.max(top + label + (item.sub ? SUB_LINE : 0) + card + 10, s.minH(item.id));
    if (item.shape !== 'decision') return { w, h };
    return { w, h: contents ? h + 24 : Math.max(diamondLines(item, w).h, s.minH(item.id) + 24) };
  }
  const kids = item.children.map((c) => size(c, s));
  const h =
    item.direction === 'column' ? kids.reduce((n, k) => n + k.h, 0) + s.gap(item) * (kids.length - 1) : Math.max(...kids.map((k) => k.h));
  return { w: itemWidth(item, s.cards, s.fig.edges, s.cap), h: h + (item.label != null ? FRAME_TOP + FRAME_BOTTOM : 0) };
}

function placeLanes(fig: FlowProps, x: number, y: number, s: Sizes, out: Placed[]): void {
  const lanes = fig.layout.children as FigGroup[];
  const { cols, starts, gaps, lead, blocks } = s.plan!;
  const colW = Array.from({ length: Math.max(-1, ...cols.values()) + 1 }, () => 0);
  for (const lane of lanes)
    for (const b of lane.children as FigNode[]) colW[cols.get(b.id)!] = Math.max(colW[cols.get(b.id)!], size(b, s).w);
  const gutter = gutterOf(lanes);
  const colsOf = (k: number) => colW.slice(starts[k], starts[k + 1]);
  const colX = colW.map((_, c) => {
    const k = laneBlock(starts, c);
    return (
      gutter +
      lead[k] +
      colsOf(k)
        .slice(0, c - starts[k])
        .reduce((a, w, i) => a + w + gaps[starts[k] + i], 0)
    );
  });
  const width = Math.max(
    ...blocks.map((k) => {
      const ws = colsOf(k);
      return (
        gutter +
        lead[k] +
        ws.reduce((a, w) => a + w, 0) +
        gaps.slice(starts[k], starts[k] + ws.length - 1).reduce((a, g) => a + g, 0) +
        (gaps[starts[k] + ws.length - 1] ?? FRAME_SIDE)
      );
    }),
  );
  const topAt = out.length;
  out.push({ x, y, w: width, h: 0, item: fig.layout });
  let ly = y;
  blocks.forEach((bk, i) => {
    if (i) ly += LANE_BLOCK_GAP - LANE_ROW_GAP;
    for (const lane of lanes) {
      const kids = (lane.children as FigNode[]).filter((b) => laneBlock(starts, cols.get(b.id)!) === bk).map((b) => ({ b, ...size(b, s) }));
      if (blocks.length > 1 && !kids.length) continue;
      const inner = Math.max(LABEL_LINE + 20, ...kids.map((k) => k.h));
      const h = inner + LANE_PAD * 2 + (s.tall.has(`${lanes.indexOf(lane)}@${bk}`) ? STUB_ROOM : 0);
      out.push({ x, y: ly, w: width, h, item: lane, lane: true, block: bk });
      for (const k of kids) out.push({ x: x + colX[cols.get(k.b.id)!], y: ly + LANE_PAD + (inner - k.h) / 2, w: k.w, h: k.h, item: k.b });
      ly += h + LANE_ROW_GAP;
    }
  });
  out[topAt].h = ly - LANE_ROW_GAP - y;
}

function placeTimeline(fig: FlowProps, x: number, y: number, out: Placed[]): void {
  const lanes = fig.layout.children as FigGroup[];
  const gutter = gutterOf(lanes);
  const lay = timelineLayout(fig, TL_AXIS_W);
  const width = gutter + TL_AXIS_W + FRAME_SIDE;
  const topAt = out.length;
  out.push({ x, y, w: width, h: 0, item: fig.layout });
  let ly = y + TL_AXIS_H;
  lanes.forEach((lane, track) => {
    const rows = lay.rows[track];
    const h = rows * TL_BAR_H + (rows - 1) * TL_ROW_GAP + LANE_PAD * 2;
    out.push({ x, y: ly, w: width, h, item: lane, lane: true });
    for (const it of lay.items) {
      if (it.track !== track) continue;
      const node = lane.children.find((k) => !isGroup(k) && k.id === it.id) as FigNode;
      const top = ly + LANE_PAD + it.row * (TL_BAR_H + TL_ROW_GAP);
      const bh = it.milestone ? it.w : TL_BAR_H;
      out.push({
        x: x + gutter + it.x,
        y: top + (TL_BAR_H - bh) / 2,
        w: it.w,
        h: bh,
        item: node,
        tl: { milestone: it.milestone, labelInside: it.labelInside },
      });
    }
    ly += h + LANE_ROW_GAP;
  });
  out[topAt].h = ly - LANE_ROW_GAP - y;
}

function place(item: FigNode | FigGroup, x: number, y: number, s: Sizes, out: Placed[]): void {
  if (item === s.fig.layout && s.fig.timeline && isLanesLayout(s.fig.layout)) return placeTimeline(s.fig, x, y, out);
  if (item === s.fig.layout && s.fig.lanes && isLanesLayout(s.fig.layout)) return placeLanes(s.fig, x, y, s, out);
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

type Seg = { t0: number; t1: number; si: number; bi: number };

/** Options for `toSvg`, `render` and `check`. */
export type SvgOptions = {
  /** Milliseconds a packet takes to cross one edge. Default: `FlowProps.speed`, else 900. */
  speed?: number;
  /** Space around the figure in px. Default: 24. */
  padding?: number;
  /** Colors. Default: `FlowProps.theme`. */
  theme?: FigTheme;
  /** Lanes: page width and smallest text size that set the wrap. Default: 830 and 10. */
  width?: number;
  minText?: number;
};

const SYSTEM_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The SVG string and the scene it drew. The scene shape may change; use `toSvg` for the SVG only. */
export function render(spec: FlowProps, opts: SvgOptions = {}): { svg: string; scene: Scene } {
  const fig = autoLayout(spec);
  const speed = (opts.speed ?? fig.speed ?? 900) / 1000 / BASE_RATE;
  const pad = opts.padding ?? 24;
  const tl = fig.timeline && isLanesLayout(fig.layout) ? timelineLayout(fig, TL_AXIS_W) : null;
  const synthetic = tl != null && !fig.steps?.length;
  const steps = synthetic ? timelineBeats(fig) : (fig.steps ?? []);
  const beats: Beat[][] = steps.map((s) => s.flow.map(toBeat));

  const cards = new Map<string, FigContent[]>();
  for (const b of beats.flat()) for (const [id, c] of Object.entries(b.show ?? {})) cards.set(id, [...(cards.get(id) ?? []), c]);

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
  const lanes = !tl && fig.lanes && isLanesLayout(fig.layout);
  const plan = lanes ? planFor(fig, opts) : null;
  const sizes: Sizes = {
    cards,
    cardH,
    minH,
    gap: (g) => groupGap(g, fig.edges),
    fig,
    plan,
    tall: new Set(plan?.tall),
    cap: fitCap(fig, opts.width ?? 830, pad),
  };
  for (const [id, contents] of cards) {
    const width = CARD_WIDTH;
    const widths = [width];
    cardH.set(id, Math.max(LINE + CARD_PAD * 2, ...contents.map((c) => layoutCard(c, Math.min(...widths) - 20).height)));
  }

  const placed: Placed[] = [];
  place(fig.layout, pad, pad, sizes, placed);
  let nodes = placed.filter((p) => !isGroup(p.item)) as (Placed & { item: FigNode })[];
  for (const p of nodes) {
    if (!cards.has(p.item.id)) continue;
    const inner = p.w - 20;
    cardH.set(p.item.id, Math.max(...cards.get(p.item.id)!.map((c) => layoutCard(c, inner).height), LINE + CARD_PAD * 2));
  }
  const rects: Record<string, Rect> = {};
  const tips = new Set(placed.filter((p) => !isGroup(p.item) && (p.item.shape === 'decision' || p.tl?.milestone)).map((p) => p.item.id!));
  const ids = fig.edges.map(edgeId);
  const stubs = plan?.stubs ?? new Map<string, string[]>();
  const gutter = plan ? gutterOf(fig.layout.children as FigGroup[]) : 0;
  const band = (id: string, k: number) => placed.find((p) => p.lane && p.item.id === id && p.block === k);
  const laneGroups = fig.layout.children as FigGroup[];
  const bandOf = (eid: string, id: string, k: 0 | 1): Rect | undefined => {
    const block = plan?.ends.get(eid)?.[k];
    const lane = laneGroups.find((l) => l.id === id || l.children.some((b) => (b as FigNode).id === id));
    return placed.find((p) => p.lane && p.item === lane && p.block === block);
  };
  const end = (eid: string, id: string, start: boolean) => (plan ? laneEnd(plan, eid, id, start, band, rects) : id);
  const go = () => {
    placed.length = 0;
    place(fig.layout, pad, pad, sizes, placed);
    for (const p of placed) if (p.item.id) rects[p.item.id] = p;
    return route(
      fig.edges.map((e, i) => ({
        id: ids[i],
        from: end(ids[i], e.from, true),
        to: end(ids[i], e.to, false),
        around: e.around ?? (plan?.around.has(ids[i]) ? ('below' as const) : undefined),
        ...(tl && { sides: ['r', 'l'] as [Side, Side], elbow: true }),
        ...(stubs.has(ids[i]) && { stub: stubs.get(ids[i])!.map(labelPillW), bands: [bandOf(ids[i], e.from, 0), bandOf(ids[i], e.to, 1)] }),
        ...(!tl && e.label != null && { labelW: labelPillW(str(e.label)) }),
      })),
      rects,
      tips,
      avoidOf(
        placed.filter((p) => !isGroup(p.item)),
        stubs.size
          ? placed.filter((p) => p.lane).map((p) => ({ x: p.x, y: p.y, w: gutter, h: p.h }))
          : placed.filter((p) => p.tl && !p.tl.labelInside).map((p) => outsideLabelRect(p, str(p.item.label))),
        stubs.size > 0,
      ),
      stubs.size ? { x: placed[0].x + gutter, y: placed[0].y, w: placed[0].w - gutter, h: placed[0].h } : undefined,
      lanes ? { bands: placed.filter((p) => p.lane), boxes: placed.filter((p) => !isGroup(p.item)) } : undefined,
      pad,
    );
  };
  let routed = go();
  for (let pass = 0; plan && pass < 3; pass++) {
    const more = [...tightCopies(laneGroups, plan.ends, fig.edges, routed)].filter((k) => !sizes.tall.has(k));
    if (!more.length) break;
    more.forEach((k) => sizes.tall.add(k));
    routed = go();
  }
  nodes = placed.filter((p) => !isGroup(p.item)) as (Placed & { item: FigNode })[];
  const byId = Object.fromEntries(routed.map((r) => [r.id, r]));

  const fonts = [14, ...(steps.length ? [13.5] : [])];
  const sceneBoxes: SceneBox[] = nodes.map((p) => {
    if (p.tl) {
      const label = str(p.item.label);
      const mine = tl!.items.find((i) => i.id === p.item.id)!;
      const next = tl!.items.filter((i) => i.track === mine.track && i.row === mine.row && i.x > mine.x).map((i) => p.x - mine.x + i.x - 8);
      const limit = Math.min(placed[0].x + placed[0].w - FRAME_SIDE, ...next);
      const room = p.tl.labelInside ? p.w - 16 : limit - (p.x + p.w) - 6;
      fonts.push(13);
      return { id: p.item.id, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, texts: [{ text: label, fontSize: 13, room }] };
    }
    const dia = p.item.shape === 'decision' && !cards.has(p.item.id);
    const dl = dia ? diamondLines(p.item as FigNode, p.w) : null;
    const room = (far: number) => diamondRoom(p.w, p.h, far);
    const flat = (p.item.shape === 'decision' ? p.w - 70 : p.w) - 16;
    const texts: SceneBox['texts'] = labelLines(p.item as FigNode, p.w).map((text) => ({
      text,
      fontSize: 14,
      room: dl ? room(dl.label.far) : flat,
    }));
    if (dl) for (const l of dl.subs) texts.push({ text: l.text, fontSize: 12, room: room(l.far) });
    else if (p.item.sub) texts.push({ text: str(p.item.sub), fontSize: 12, room: flat });
    if (p.item.sub) fonts.push(12);
    for (const c of cards.get(p.item.id) ?? [])
      for (const r of layoutCard(c, p.w - 20).rows) {
        const fontSize = r.row.mono ? 10.5 : 11;
        fonts.push(fontSize);
        for (const line of r.lines) texts.push({ text: line, fontSize, room: r.room, mono: r.row.mono });
      }
    return { id: p.item.id, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, texts };
  });
  if (placed.some((p) => isGroup(p.item) && p.item.label != null)) fonts.push(11);

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

  const shownAt = segs.map(
    ({ si, bi }) => Object.assign({}, ...beats[si].slice(0, bi + 1).map((b) => b.show)) as Record<string, FigContent>,
  );
  const litEdges = segs.map(({ si, bi }) => new Set(beats[si].slice(0, bi + 1).flatMap((b) => b.hops.map((h) => h.edge))));
  const litNodes = segs.map((seg, i) => {
    const on = new Set<string>([
      ...(steps[seg.si].nodes ?? []),
      ...Object.keys(shownAt[i]),
      ...(beats[seg.si][seg.bi].light ?? []),
      ...(beats[seg.si][seg.bi].focus ?? []),
    ]);
    fig.edges.forEach((e, ei) => {
      if (litEdges[i].has(ids[ei])) on.add(e.from).add(e.to);
    });
    return on;
  });
  const captions = segs.map(({ si, bi }) => {
    const said = beats[si].slice(0, bi + 1).findLastIndex((b) => b.say != null);
    return str(said === -1 ? steps[si].caption : beats[si][said].say);
  });

  const css: string[] = [];
  const seen = new Map<string, string>();
  const runs = (values: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < segs.length;) {
      let j = i;
      while (j + 1 < segs.length && values[j + 1] === values[i]) j++;
      out.push(`${pct(segs[i].t0 / total)},${pct(segs[j].t1 / total - 0.0001)} { ${values[i]} }`);
      i = j + 1;
    }
    return out.join(' ');
  };
  const anim = (on: boolean[], onCss: string, offCss: string, prefix: string): string => {
    if (!segs.length || on.every((x) => !x)) return '';
    const key = prefix + on.map((x) => (x ? 1 : 0)).join('');
    if (!seen.has(key)) {
      const name = `a${seen.size}`;
      seen.set(key, name);
      const frames = runs(on.map((x) => (x ? onCss : offCss)));
      css.push(`@keyframes ${name} { ${frames} }\n.${name} { animation: ${name} ${n2(total)}s infinite step-end; }`);
    }
    return seen.get(key)!;
  };
  // One class attribute only: two would be invalid XML.
  const cls = (...names: (string | false | undefined)[]) => {
    const list = names.filter(Boolean).join(' ');
    return list ? ` class="${list}"` : '';
  };

  const frames = (values: string[], prefix: string, base = values[0]): string => {
    if (!segs.length || values.every((v) => v === base)) return '';
    const key = prefix + values.join('|');
    if (!seen.has(key)) {
      const name = `a${seen.size}`;
      seen.set(key, name);
      const kf = runs(values);
      css.push(`@keyframes ${name} { ${kf} }\n.${name} { animation: ${name} ${n2(total)}s infinite step-end; }`);
    }
    return seen.get(key)!;
  };

  // FADE and RAMP are wall seconds; the player matches them in ms.
  const FADE = 0.4;
  const RAMP = 0.4;
  const looks = (look: 'off' | 'trail' | 'active', boxTone?: string, hopTone?: string) => {
    const tint = boxTone ? toneTint(boxTone, 'var(--bg)') : 'var(--bg)';
    if (look === 'off') return [tint, boxTone ?? 'var(--border)', 1, 'drop-shadow(0 0 0 transparent)'] as const;
    if (look === 'trail') return [tint, boxTone ?? 'var(--accent)', 1, 'drop-shadow(0 0 0 transparent)'] as const;
    const c = hopTone ?? boxTone;
    return c
      ? ([toneTint(c, 'var(--surface)', 10), c, 2, `drop-shadow(0 0 4px ${c})`] as const)
      : (['var(--tint)', 'var(--accent)', 2, 'drop-shadow(0 0 4px var(--accent))'] as const);
  };
  const hopsAt = new Map<string, typeof hops>();
  for (const h of hops) {
    const k = `${h.si}:${h.bi}:${h.dest}`;
    const list = hopsAt.get(k);
    if (list) list.push(h);
    else hopsAt.set(k, [h]);
  }
  const boxAnim = (id: string, shape: boolean, boxTone?: string): string => {
    const pieces: { a: number; b: number; look: 'off' | 'trail' | 'active'; hop?: string; ramp?: number }[] = [];
    segs.forEach((s, i) => {
      if (!litNodes[i].has(id)) return void pieces.push({ a: s.t0, b: s.t1, look: 'off' });
      const here = hopsAt.get(`${s.si}:${s.bi}:${id}`) ?? [];
      const focused = beats[s.si][s.bi].focus?.includes(id);
      const arrive = Math.min(...here.map((h) => h.t1), focused ? Math.min(s.t0 + (tl ? RAMP : 0), s.t1) : s.t1, s.t1);
      if (arrive > s.t0) pieces.push({ a: s.t0, b: arrive, look: 'trail' });
      if (arrive < s.t1) pieces.push({ a: arrive, b: s.t1, look: 'active', hop: here.find((h) => h.tone)?.tone });
    });
    if (!pieces.length || pieces.every((q) => q.look === 'off')) return '';
    const end = pieces.at(-1)!;
    if (end.look === 'active') {
      end.b -= FADE;
      pieces.push({ a: end.b, b: end.b + FADE, look: pieces[0].look, hop: pieces[0].hop, ramp: FADE - 0.0002 * total });
    }
    const merged: { a: number; b: number; css: string }[] = [];
    pieces.forEach((q, k) => {
      const ramp = q.ramp ?? (q.look !== 'active' && pieces[k - 1]?.look === 'active' ? Math.min(FADE, (q.b - q.a) / 2) : 0);
      const [fill, stroke, width, filter] = looks(q.look, boxTone, q.hop);
      const css = `${shape ? `fill: ${fill}; ` : ''}stroke: ${stroke}; stroke-width: ${width}${shape ? `; filter: ${filter}` : ''}`;
      const last = merged.at(-1);
      if (last?.css === css) last.b = q.b;
      else merged.push({ a: q.a + ramp, b: q.b, css });
    });
    const kf = merged.map((f) => `${pct(f.a / total)},${pct(f.b / total - 0.0001)} { ${f.css} }`);
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
        cls(p.lane && 'lane', anim(on, 'stroke: var(--accent)', 'stroke: var(--border)', 'n')) +
        `/><text x="${n2(p.x + FRAME_SIDE)}" y="${n2(p.lane ? p.y + p.h / 2 + 4 : p.y + 20)}" class="frame">${esc(str(item.label).toUpperCase())}</text>`
      );
    }
    const tip = (inner: string) => (item.source ? `<g><title>${esc(item.source)}</title>${inner}</g>` : inner);
    const bt = item.tone && TONES[item.tone];
    const stroke = cls(boxAnim(item.id, true, bt));
    if (p.tl) {
      const fill0 = bt ? toneTint(bt, 'var(--bg)') : 'var(--bg)';
      const stroke0 = bt ?? 'var(--border)';
      const label = str(item.label);
      const inside = p.tl.labelInside;
      const cx = p.x + p.w / 2,
        cy = p.y + p.h / 2;
      const shape = p.tl.milestone
        ? `<polygon points="${n2(cx)},${n2(p.y)} ${n2(p.x + p.w)},${n2(cy)} ${n2(cx)},${n2(p.y + p.h)} ${n2(p.x)},${n2(cy)}" fill="${fill0}" stroke="${stroke0}"${stroke}/>`
        : `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" rx="6" fill="${fill0}" stroke="${stroke0}"${stroke}/>`;
      const tx = inside ? p.x + 8 : p.x + p.w + 6;
      return tip(shape + `<text x="${n2(tx)}" y="${n2(cy + 4.5)}" class="bar">${esc(label)}</text>`);
    }
    const rim = item.shape === 'store' ? cls(boxAnim(item.id, false, bt)) : '';
    const fill0 = bt ? toneTint(bt, 'var(--bg)') : 'var(--bg)';
    const stroke0 = bt ?? 'var(--border)';
    const cx = p.x + p.w / 2;
    const contents = cards.get(item.id);
    const cardTop = p.y + p.h - 10 - (contents ? cardH.get(item.id)! : 0);
    const dl = item.shape === 'decision' && !contents ? diamondLines(item, p.w) : null;
    const labelY =
      item.shape === 'store' ? p.y + 24 + 13 : contents ? p.y + 10 + 13 : p.y + p.h / 2 + (dl ? dl.label.dy : item.sub ? -2 : 5);
    const shape =
      item.shape === 'decision'
        ? `<polygon points="${n2(cx)},${n2(p.y)} ${n2(p.x + p.w)},${n2(p.y + p.h / 2)} ${n2(cx)},${n2(p.y + p.h)} ${n2(p.x)},${n2(p.y + p.h / 2)}" fill="${fill0}" stroke="${stroke0}"${stroke}/>`
        : item.shape === 'store'
          ? `<path d="M${n2(p.x)} ${n2(p.y + 12)} a ${n2(p.w / 2)} 12 0 0 1 ${n2(p.w)} 0 v ${n2(p.h - 24)} a ${n2(p.w / 2)} 12 0 0 1 ${n2(-p.w)} 0 z" fill="${fill0}" stroke="${stroke0}"${stroke}/>` +
            `<path d="M${n2(p.x)} ${n2(p.y + 12)} a ${n2(p.w / 2)} 12 0 0 0 ${n2(p.w)} 0" fill="none" stroke="${stroke0}"${rim}/>`
          : `<rect x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" rx="10" fill="${fill0}" stroke="${stroke0}"${stroke}/>`;
    const lines = labelLines(item, p.w);
    const extra = (lines.length - 1) * LABEL_LINE;
    const firstY = item.shape === 'store' || contents ? labelY : labelY - extra / 2;
    const label = lines.map((l, i) => `<text x="${n2(cx)}" y="${n2(firstY + i * LABEL_LINE)}" class="label">${esc(l)}</text>`).join('');
    const sub = dl
      ? dl.subs.map((l) => `<text x="${n2(cx)}" y="${n2(p.y + p.h / 2 + l.dy)}" class="sub">${esc(l.text)}</text>`).join('')
      : item.sub
        ? `<text x="${n2(cx)}" y="${n2(firstY + extra + SUB_LINE)}" class="sub">${esc(str(item.sub))}</text>`
        : '';
    const dot = bt ?? 'var(--accent)';
    const my = n2(p.y + p.h / 2);
    const mark =
      item.mark === 'start'
        ? `<circle cx="${n2(p.x - 12)}" cy="${my}" r="5" fill="${dot}"/>`
        : item.mark === 'end'
          ? `<circle cx="${n2(p.x + p.w + 12)}" cy="${my}" r="6.25" fill="none" stroke="${dot}" stroke-width="1.5"/><circle cx="${n2(p.x + p.w + 12)}" cy="${my}" r="4" fill="${dot}"/>`
          : '';
    return tip(shape + label + sub + mark + (contents ? card(p as Rect & { item: FigNode }, cardTop, contents) : ''));
  });

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
    const tone = segs.map(
      ({ si, bi }) => (beats[si][bi].hops.find((h) => h.edge === r.id && h.tone)?.tone ?? undefined) as FigTone | undefined,
    );
    const col = tone.map((x) => (x ? TONES[x] : 'var(--accent)'));
    const off = `stroke: var(--muted); stroke-width: ${EDGE_OFF}`;
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
    const tip = edgeTip(r.id, e.source, beats.flat());
    const path0 = r.stub
      ? r.stub.parts
          .map((d) => `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="${EDGE_OFF}" marker-end="url(#arrow)"${lit}/>`)
          .join('') + `<path id="p-${esc(r.id)}" d="${r.d}" fill="none" stroke="none"/>`
      : `<path id="p-${esc(r.id)}" d="${r.d}" fill="none" stroke="var(--muted)" stroke-width="${EDGE_OFF}" marker-end="url(#arrow)"${lit}/>`;
    const path = tip ? `<g><title>${esc(tip)}</title>${path0}</g>` : path0;
    const pill = (x: number, y: number, lw: number, text: string) =>
      `<rect x="${n2(x - lw / 2)}" y="${n2(y - 9)}" width="${n2(lw)}" height="18" rx="9" fill="var(--bg)" stroke="var(--border)"` +
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
      `/><text x="${n2(x)}" y="${n2(y + 4)}"${cls('edgelabel', anim(on, `fill: ${ON_ACCENT}`, 'fill: var(--muted)', 'x'))}>${esc(text)}</text>`;
    let label = '';
    if (r.stub) {
      fonts.push(11);
      const texts = stubs.get(r.id)!;
      label = r.stub.pills.map((p, k) => pill(p.x + p.w / 2, p.y + 9, p.w, k === 0 && r.stub!.short ? texts[2] : texts[k])).join('');
    } else if (e.label != null && !tl) {
      const lw = labelPillW(str(e.label));
      labelRects[r.id] = { x: r.mid.x - lw / 2, y: r.mid.y - 9, w: lw, h: 18 };
      fonts.push(11);
      label = pill(r.mid.x, r.mid.y, lw, str(e.label));
    }
    return hidden ? `<g opacity="0"${shown}>${path}${label}</g>` : path + label;
  });

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

  let axisSvg = '',
    lineSvg = '',
    todaySvg = '';
  if (tl) {
    const top = placed[0];
    const x0 = top.x + gutterOf(fig.layout.children as FigGroup[]);
    const ay = top.y + TL_AXIS_H;
    fonts.push(11);
    axisSvg =
      `<path d="M ${n2(x0)} ${n2(ay - 1)} H ${n2(x0 + TL_AXIS_W)}" stroke="var(--border)"/>` +
      tl.ticks
        .map(
          (k) =>
            `<path d="M ${n2(x0 + k.x)} ${n2(ay - 5)} V ${n2(ay - 1)}" stroke="var(--border)"/>` +
            `<text x="${n2(x0 + k.x + 3)}" y="${n2(top.y + 10)}" class="tick">${esc(k.label)}</text>`,
        )
        .join('');
    const bottom = n2(top.y + top.h);
    if (tl.today != null) {
      const tx = x0 + tl.today;
      lineSvg = `<path d="M ${n2(tx)} ${n2(top.y + 12)} V ${bottom}" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="3 3"/>`;
      todaySvg = `<text x="${n2(tx - 3)}" y="${n2(top.y + 22)}" text-anchor="end" class="today">today</text>`;
    }
    if (tl.last != null && segs.length) {
      const home = tl.last;
      const startOf = new Map(tl.items.map((i) => [i.id, i.x + (i.milestone ? i.w / 2 : 0)]));
      const dateOf = new Map(tl.items.map((i) => [i.id, i.date]));
      const hold = STEP_HOLD_MS / 1000 / BASE_RATE;
      const first = loopStartItem(tl.items, steps);
      const start = first ? startOf.get(first.id)! : home;
      const pts: [number, number][] = [[0, start]];
      const dates: { a: number; b: number; d: string; x: number }[] = [];
      let at = start;
      segs.forEach((s, i) => {
        const item = playheadItem(tl.items, beats[s.si], s.bi);
        const to = item ? startOf.get(item.id)! : home;
        const date = item ? dateOf.get(item.id)! : tl.lastDate;
        const last = i === segs.length - 1 || segs[i + 1].si !== s.si;
        const end = last ? s.t1 - hold : s.t1;
        pts.push([s.t0, at], [Math.min(s.t0 + RAMP, end), to], [end, to]);
        const [la, lb] = i === 0 && to === start ? [s.t0, end] : labelSpan(s.t0, end, RAMP);
        if (la < lb) dates.push({ a: la, b: lb, d: date, x: to });
        at = to;
        if (last) {
          const back = i === segs.length - 1 ? Math.max(end + RAMP, s.t1 - RAMP) : s.t1;
          pts.push([Math.min(end + RAMP, s.t1), home], [back, home]);
          const [ha, hb] = labelSpan(end, back, RAMP);
          if (ha < hb) dates.push({ a: ha, b: hb, d: tl.lastDate, x: home });
          if (back < s.t1) pts.push([s.t1, start]);
          at = home;
        }
      });
      const name = `a${seen.size}`;
      seen.set('playhead', name);
      const kf = pts.map(([t, x]) => `${pct(t / total)} { transform: translateX(${n2(x - home)}px) }`).join(' ');
      css.push(`@keyframes ${name} { ${kf} }\n.${name} { animation: ${name} ${n2(total)}s infinite linear; }`);
      const lx = x0 + home;
      const labels = [...new Set(dates.map((x) => x.d))].map((d) => {
        const on = dates.map((x) => x.d === d);
        const key = `d${d}${on.map((x) => (x ? 1 : 0)).join('')}`;
        if (!seen.has(key)) {
          const nm = `a${seen.size}`;
          seen.set(key, nm);
          const fr = dates
            .map(
              (x) =>
                `${pct(x.a / total)},${pct(x.b / total - 0.0001)} { opacity: ${x.d === d ? 1 : 0} } ${pct(x.b / total)} { opacity: 0 }`,
            )
            .join(' ');
          css.push(`@keyframes ${nm} { ${fr} }\n.${nm} { animation: ${nm} ${n2(total)}s infinite step-end; }`);
        }
        const raised = dateLabelRaised(dates.find((x) => x.d === d)!.x, tl.today, textWidth(d, 11), textWidth('today', 11));
        return `<text x="${n2(lx + 3)}" y="${n2(top.y + (raised ? 10 : 22))}" opacity="0"${cls('today', seen.get(key))}>${esc(d)}</text>`;
      });
      lineSvg += `<g${cls(name)}><path d="M ${n2(lx)} ${n2(top.y + 12)} V ${bottom}" stroke="var(--accent)" stroke-width="1.5"/></g>`;
      todaySvg += `<g${cls(name)}>${labels.join('')}</g>`;
    }
  }

  const bounds = placed[0];
  const [arcT, arcB, arcL, arcR] = (['above', 'below', 'left', 'right'] as const).map((w) => arcRoom(routed, w));
  const capLines = [...new Set(captions)].flatMap((c) => wrap(c, Math.max(560, bounds.w), 13.5).length);
  const mapW = Math.max(bounds.w + pad * 2 + arcL + arcR, 560);
  const rail: Rail | null = fig.rail ? layoutRail(fig, fig.rail === 'only' ? 560 : mapW) : null;
  const only = fig.rail === 'only' && rail != null;
  const capTop = rail ? 20 : 26;
  const capH = steps.length ? capTop + 4 + Math.max(0, ...capLines) * 20 : 0;
  const W = only ? Math.max(560, rail.width) : Math.max(mapW, rail?.width ?? 0);
  const mapH = only ? 0 : bounds.h + pad * 2 + arcT + arcB;
  const top = only ? pad : mapH + RAIL.gap;
  const H = only ? pad + rail.height + capH : mapH + (rail ? RAIL.gap + rail.height : 0) + capH;
  const shift = (W - (bounds.w + pad * 2 + arcL + arcR)) / 2 + arcL;
  const railX = rail ? (W - rail.width) / 2 : 0;

  const labels =
    rail || synthetic
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

  const railSvg = !rail
    ? ''
    : (() => {
        const parts: string[] = [];
        const cols = rail.head - RAIL.cols / 2 + 4;
        for (const b of rail.bands)
          parts.push(
            `<rect x="${n2(b.rect.x)}" y="${n2(top + b.rect.y)}" width="${n2(b.rect.w)}" height="${n2(b.rect.h)}" rx="10" fill="var(--surface)" stroke="var(--border)"/>` +
              `<text x="${n2(b.rect.x + 10)}" y="${n2(top + b.rect.y + 14)}" class="frame">${esc(b.label.toUpperCase())}</text>`,
          );
        for (const c of rail.columns) parts.push(`<text x="${n2(c.x)}" y="${n2(top + cols)}" class="railcol">${esc(c.label)}</text>`);
        const at = (i: number) => segs.map((s) => railState(rail, s.si)[i]);
        const base = (i: number) => railState(rail, 0)[i].y;
        const moveRow = (i: number) =>
          frames(
            at(i).map((st) => `transform: translateY(${n2(st.y - base(i))}px); opacity: ${st.shown ? 1 : 0}`),
            'm',
          );
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
            const first = new Map<number, number>();
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
          const tip = edgeTip(row.edge, fig.edges[ids.indexOf(row.edge)].source, beats.flat());
          parts.push(
            `<g${cls('railrow', moveRow(i))}>${tip ? `<title>${esc(tip)}</title>` : ''}<g${cls(anim(next, 'opacity: .45', 'opacity: 1', 'r'))}>` +
              `<path d="M ${n2(x1)} ${n2(ly)} H ${n2(x2)}" fill="none" stroke="var(--muted)" stroke-width="${EDGE_OFF}"${row.async ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#arrow)"${cls(lit)}/>` +
              tag +
              pill +
              `</g></g>`,
          );
        });
        return `<g transform="translate(${n2(railX)} 0)">${parts.join('')}</g>`;
      })();

  const { font, ...t0 } = { ...LIGHT, ...fig.theme, ...opts.theme };
  const alt = altText(fig);
  const holdAt = beats[0]?.length ? n2(segs[beats[0].length - 1].t1 - 0.1) : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(W)}" height="${n2(H)}" viewBox="0 0 ${n2(W)} ${n2(H)}" font-family="${esc(font ?? SYSTEM_FONT)}" role="img">
<title>${esc(alt.title)}</title>
<desc>${esc(alt.desc)}</desc>
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
.bar { fill: var(--fg); font-size: 13px; font-weight: 500; }
.tick { fill: var(--muted); font-size: 11px; }
.today { fill: var(--accent); font-size: 11px; font-weight: 600; }
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
@media (prefers-reduced-motion: reduce) { * { animation-play-state: paused !important; animation-delay: -${holdAt}s !important; } }
</style>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke"/></marker></defs>
<rect width="100%" height="100%" fill="var(--bg)"/>
${
  only
    ? ''
    : `<g transform="translate(${n2(shift)} ${arcT})">
${axisSvg}
${tl ? boxes.filter((b, i) => b && isGroup(placed[i].item)).join('\n') : ''}${lineSvg && `\n${lineSvg}`}
${tl ? edgeSvg.join('\n') : ''}
${boxes.filter((b, i) => b && !(tl && isGroup(placed[i].item))).join('\n')}
${tl ? '' : edgeSvg.join('\n')}
${packets.join('\n')}
${todaySvg}
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
    ...(!only && { area: { x: -shift, y: -arcT, w: W, h: mapH } }),
    boxes: only ? [] : sceneBoxes,
    edges: [
      ...(only ? [] : routed).flatMap((r): SceneEdge[] => {
        const e = fig.edges[ids.indexOf(r.id)];
        if (r.stub) return r.stub.pts.map((pts, k) => ({ id: r.id, from: e.from, to: e.to, curve: r.curve, pts, label: r.stub!.pills[k] }));
        return [
          {
            id: r.id,
            from: e.from,
            to: e.to,
            curve: r.curve,
            label: labelRects[r.id],
            ...(tl && { behind: true as const }),
            ...(r.elbow && { elbow: r.elbow }),
          },
        ];
      }),
      ...(rail?.rows ?? []).flatMap((row, i) => {
        if (row.kind !== 'message') return [];
        const dx = only ? railX : railX - shift,
          dy = only ? top : top - arcT;
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
    ...(lanes && {
      lanes: placed.filter((p) => p.lane).map((p) => ({ id: str((p.item as FigGroup).label), rect: { x: p.x, y: p.y, w: p.w, h: p.h } })),
    }),
  };
  return { svg, scene };
}

/** One self-contained animated SVG string for the figure. Needs no React and no browser. */
export function toSvg(fig: FlowProps, opts: SvgOptions = {}): string {
  return render(fig, opts).svg;
}

/** Every fault `flowfig check` knows about, for this figure as the SVG lays it out. */
export function check(fig: FlowProps, opts: SvgOptions & CheckOptions = {}): Finding[] {
  return checkRendered(fig, opts, render(fig, opts).scene);
}
