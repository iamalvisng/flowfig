import type { Rect } from './geometry.ts';
import { edgeId, isGroup, labelPillW, str, toBeat, type FigGroup, type FigNode, type FigTone, type FlowProps } from './model.ts';
import { textWidth } from './text.ts';

export const RAIL = {
  gap: 24,
  band: 20,
  cols: 28,
  phase: 30,
  row: 34,
  minCol: 120,
  pad: 24,
  bandInset: 8,
  clear: 12,
  inset: 6,
  maxOpen: 10,
} as const;

export type RailColumn = { id: string; label: string; x: number; w: number };
export type RailBand = { id: string; label: string; rect: Rect };
export type RailRow =
  | {
      kind: 'phase';
      step: number;
      label: string;
      messages: number;
      line: { open: number; folded: number; end: number };
    }
  | {
      kind: 'message';
      step: number;
      beat: number;
      n: number;
      edge: string;
      from: number;
      to: number;
      text: string;
      async: boolean;
      tone?: FigTone;
      pill?: { x: number; w: number };
      group?: number;
    };
export type RailState = { y: number; shown: boolean };
export type Rail = {
  width: number;
  /** The y where the first row starts. */
  head: number;
  height: number;
  columns: RailColumn[];
  bands: RailBand[];
  rows: RailRow[];
  groups: { step: number; rows: number[] }[];
  total: number;
  folds: boolean;
  states: RailState[][];
};

export const foldedLabel = (row: { label: string; messages: number }) => `▸ ${row.label} · ${row.messages} messages`;

const order = (item: FigNode | FigGroup): { id: string; label: string }[] =>
  isGroup(item)
    ? [...(item.id ? [{ id: item.id, label: str(item.label) }] : []), ...item.children.flatMap(order)]
    : [{ id: item.id, label: str(item.label) }];

export function railState(rail: Rail, step: number): RailState[] {
  return rail.states[Math.min(step, rail.states.length - 1)] ?? rail.states[0];
}

export function layoutRail(fig: FlowProps, mapWidth: number): Rail | null {
  const steps = fig.steps ?? [];
  const edges = new Map(fig.edges.map((e) => [edgeId(e), e]));
  const layoutIds = new Set(order(fig.layout).map((o) => o.id));

  type Msg = { step: number; beat: number; edge: string; back: boolean; text: string; async: boolean; tone?: FigTone };
  const perStep: Msg[][][] = steps.map((s, si) =>
    s.flow.map(toBeat).map((b, bi) =>
      b.hops
        .filter((h) => {
          if (!edges.has(h.edge)) return false;
          const e = edges.get(h.edge)!;
          return layoutIds.has(e.from) && layoutIds.has(e.to);
        })
        .map((h) => ({
          step: si,
          beat: bi,
          edge: h.edge,
          back: h.back,
          text: str(h.data) || str(edges.get(h.edge)!.label),
          async: h.async === true,
          tone: h.tone,
        })),
    ),
  );
  const msgs = perStep.flat(2);
  if (!msgs.length) return null;

  const used = new Set(msgs.flatMap((m) => [edges.get(m.edge)!.from, edges.get(m.edge)!.to]));
  const cols = order(fig.layout).filter((c) => used.has(c.id));
  const index = new Map(cols.map((c, i) => [c.id, i]));

  let need: number = RAIL.minCol;
  for (const c of cols) need = Math.max(need, textWidth(c.label, 12) + 16 + RAIL.bandInset * 2);
  for (const m of msgs) if (m.text) need = Math.max(need, labelPillW(m.text) + 16);

  const folds = msgs.length > RAIL.maxOpen;
  const labelW = (text: string) => textWidth(text, 13, true);
  const counterW = (() => {
    const text = `${msgs.length} of ${msgs.length}`;
    return textWidth(text, 11) + 0.04 * 11 * text.length; // the frame style adds .04em letter spacing
  })();
  const widest = Math.max(
    ...perStep.map((b, si) => {
      const label = str(steps[si].label);
      return labelW(folds ? foldedLabel({ label, messages: b.flat().length }) : label);
    }),
  );

  const place = (left: number, right: number, colW: number) => {
    const width = left + colW * cols.length + right;
    const columns: RailColumn[] = cols.map((c, i) => ({ id: c.id, label: c.label, x: left + colW * (i + 0.5), w: colW }));
    const bands: RailBand[] = [];
    const walk = (g: FigGroup, depth: number) => {
      const ids = new Set(order(g).map((o) => o.id));
      const inside = columns.filter((c) => ids.has(c.id));
      if (g.label != null && inside.length) {
        const l = Math.min(...inside.map((c) => c.x - c.w / 2)) + RAIL.bandInset + depth * 4;
        const r = Math.max(...inside.map((c) => c.x + c.w / 2)) - RAIL.bandInset - depth * 4;
        bands.push({ id: g.id ?? str(g.label), label: str(g.label), rect: { x: l, y: depth * RAIL.band, w: r - l, h: 0 } });
      }
      for (const c of g.children) if (isGroup(c)) walk(c, depth + (g.label != null ? 1 : 0));
    };
    walk(fig.layout, 0);
    const borders = bands.flatMap((b) => [b.rect.x, b.rect.x + b.rect.w]);
    const dl = Math.max(0, RAIL.pad + widest + RAIL.clear - Math.min(Infinity, ...borders));
    const dr = Math.max(0, Math.max(-Infinity, ...borders) - (width - RAIL.pad - counterW - RAIL.clear));
    return { width, columns, bands, dl, dr };
  };
  const spread = (left: number, right: number) => Math.max(need, (mapWidth - left - right) / cols.length);
  let [left, right] = [RAIL.pad, RAIL.pad];
  let colW = spread(left, right);
  let placed = place(left, right, colW);
  for (let k = 0; placed.dl > 0.01 || placed.dr > 0.01; k++) {
    left += placed.dl;
    right += placed.dr;
    if (k < 8) colW = spread(left, right);
    placed = place(left, right, colW);
  }
  const { width, columns, bands } = placed;
  const head = (bands.length ? Math.max(...bands.map((b) => b.rect.y)) + RAIL.band : 0) + RAIL.cols;

  const rows: RailRow[] = [];
  const groups: Rail['groups'] = [];
  let n = 0;
  perStep.forEach((stepBeats, si) => {
    const label = str(steps[si].label),
      messages = stepBeats.flat().length;
    const after = (text: string) => RAIL.pad + labelW(text) + RAIL.clear;
    const line = { open: after(label), folded: after(foldedLabel({ label, messages })), end: width - RAIL.pad - counterW - RAIL.clear };
    rows.push({ kind: 'phase', step: si, label, messages, line });
    for (const beatMsgs of stepBeats) {
      const group = beatMsgs.length > 1 ? groups.push({ step: si, rows: [] }) - 1 : undefined;
      for (const m of beatMsgs) {
        const e = edges.get(m.edge)!;
        const [a, b] = m.back ? [e.to, e.from] : [e.from, e.to];
        const from = index.get(a)!,
          to = index.get(b)!;
        const mid = (columns[from].x + columns[to].x) / 2;
        const pill = m.text ? { x: mid - labelPillW(m.text) / 2, w: labelPillW(m.text) } : undefined;
        if (group != null) groups[group].rows.push(rows.length);
        rows.push({
          kind: 'message',
          step: si,
          beat: m.beat,
          n: ++n,
          edge: m.edge,
          from,
          to,
          text: m.text,
          async: m.async,
          tone: m.tone,
          pill,
          group,
        });
      }
    }
  });

  const states = steps.map((_, open) => {
    let y = head;
    return rows.map((row) => {
      const shown = !folds || row.kind === 'phase' || row.step === open;
      const s = { y, shown };
      if (shown) y += row.kind === 'phase' ? RAIL.phase : RAIL.row;
      return s;
    });
  });
  const bottom = (s: RailState[]) =>
    s.reduce((m, st, i) => (st.shown ? Math.max(m, st.y + (rows[i].kind === 'phase' ? RAIL.phase : RAIL.row)) : m), 0);
  const height = Math.max(...states.map(bottom)) + 8;

  for (const b of bands) b.rect.h = height - b.rect.y - (b.rect.y / RAIL.band) * 4;

  return { width, head, height, columns, bands, rows, groups, total: n, folds, states };
}

/** A parallel band around its rows, relative to the y of its first row: RAIL.inset around every arrow and pill it holds. */
export function groupBox(rail: Rail, g: Rail['groups'][number]): Rect {
  const xs = g.rows.flatMap((k) => {
    const r = rail.rows[k];
    if (r.kind !== 'message') return [];
    return [rail.columns[r.from].x, rail.columns[r.to].x, ...(r.pill ? [r.pill.x, r.pill.x + r.pill.w] : [])];
  });
  const x = Math.min(...xs) - RAIL.inset;
  const top = (RAIL.row - 18) / 2 - RAIL.inset;
  return { x, y: top, w: Math.max(...xs) + RAIL.inset - x, h: g.rows.length * RAIL.row - top * 2 };
}
