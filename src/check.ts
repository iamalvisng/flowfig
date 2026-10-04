import {
  DARK,
  LIGHT,
  ON_ACCENT,
  TONES,
  edgeId,
  isGroup,
  dayOf,
  isLanesLayout,
  lanePlan,
  validAt,
  laneColumns,
  nodes,
  str,
  toBeat,
  type FigGroup,
  type FigNode,
  type FigTheme,
  type FlowProps,
  type LanePlan,
} from './model.ts';
import type { Finding, Scene, SceneEdge } from './scene.ts';
import { layoutRail } from './rail.ts';
import type { SvgOptions } from './svg.ts';
import { crosses, type Pt, type Rect } from './geometry.ts';
import { textWidth } from './text.ts';
import { owners, parseSource } from './source.ts';

const err = (rule: string, ids: string[], message: string): Finding => ({ rule, severity: 'error', ids, message });
const warn = (rule: string, ids: string[], message: string): Finding => ({ rule, severity: 'warning', ids, message });

const groupIds = (g: FigGroup): string[] => [...(g.id ? [g.id] : []), ...g.children.flatMap((c) => (isGroup(c) ? groupIds(c) : []))];

/** Faults in the spec: dangling ids, duplicate ids, empty steps. The renderers skip them silently. */
export function checkSpec(fig: FlowProps): Finding[] {
  const out: Finding[] = [];
  const boxIds = nodes(fig.layout).map((n) => n.id);
  const groups = groupIds(fig.layout);
  const edges = fig.edges.map(edgeId);
  const twice = (kind: string, list: string[]) =>
    new Set(list.filter((id, i) => list.indexOf(id) !== i)).forEach((id) =>
      out.push(err('duplicate-id', [id], `two ${kind} have the id "${id}"`)),
    );
  twice('boxes', boxIds);
  twice('groups', groups);
  twice('edges', edges);

  const known = new Set([...boxIds, ...groups]);
  const knownEdges = new Set(edges);
  fig.edges.forEach((e, i) => {
    for (const end of [e.from, e.to])
      if (!known.has(end)) out.push(err('unknown-id', [edges[i], end], `edge "${edges[i]}" names box "${end}", which does not exist`));
  });
  (fig.steps ?? []).forEach((s, si) => {
    const where = `step ${si + 1} ("${str(s.label)}")`;
    if (!s.flow.length) out.push(warn('empty-step', [], `${where} has no beats`));
    for (const id of s.nodes ?? [])
      if (!known.has(id)) out.push(err('unknown-id', [id], `${where}: nodes names box "${id}", which does not exist`));
    for (const b of s.flow.map(toBeat)) {
      for (const h of b.hops)
        if (!knownEdges.has(h.edge)) out.push(err('unknown-id', [h.edge], `${where} moves along edge "${h.edge}", which does not exist`));
      for (const id of [...Object.keys(b.show ?? {}), ...(b.light ?? []), ...(b.focus ?? [])])
        if (!known.has(id)) out.push(err('unknown-id', [id], `${where}: show, light or focus names box "${id}", which does not exist`));
    }
  });
  const used = new Set((fig.steps ?? []).flatMap((s) => s.flow.flatMap((b) => toBeat(b).hops.map((h) => h.edge))));
  fig.edges.forEach((e, i) => {
    if (e.quiet && !used.has(edges[i]))
      out.push(err('hidden-edge', [edges[i]], `edge "${edges[i]}" is quiet and no beat uses it, so the figure never shows it`));
  });
  for (const [who, source] of owners(fig))
    if (source != null && !parseSource(source)) out.push(warn('bad-source', [], `${who}: source "${source}" is not path or path#symbol`));
  const marks = nodes(fig.layout).map((n) => n.mark);
  const starts = marks.filter((m) => m === 'start').length;
  const ends = marks.filter((m) => m === 'end').length;
  if (starts > 1 || (starts && !ends))
    out.push(warn('mark-count', [], `a lifecycle has one start and at least one end: ${starts} start, ${ends} end`));
  if (fig.timeline && fig.lanes)
    out.push(warn('timeline-and-lanes', [], 'the figure sets timeline and lanes; the renderers draw the timeline and ignore lanes'));
  if (fig.timeline) {
    if (!isLanesLayout(fig.layout))
      out.push(
        err(
          'lanes-need-column',
          [],
          'a timeline uses the lanes layout: a column group of labeled groups, one per track, with boxes only inside',
        ),
      );
    for (const n of nodes(fig.layout)) {
      if (n.from == null) out.push(err('timeline-need-from', [n.id], `box "${n.id}" has no from date, and a timeline needs one`));
      const [f, t] = [n.from == null ? null : dayOf(n.from), n.to == null ? null : dayOf(n.to)];
      for (const [name, v, d] of [
        ['from', n.from, f],
        ['to', n.to, t],
      ] as const)
        if (v != null && d == null) out.push(err('bad-date', [n.id], `box "${n.id}": ${name} "${v}" is not a real YYYY-MM-DD date`));
      if (f != null && t != null && t < f) out.push(err('bad-date', [n.id], `box "${n.id}": to ${n.to} is before from ${n.from}`));
    }
    const span = new Map(
      nodes(fig.layout).map((n) => [n.id, [n.from && dayOf(n.from), (n.to && dayOf(n.to)) ?? (n.from && dayOf(n.from))] as const]),
    );
    for (const e of fig.edges) {
      const start = span.get(e.to)?.[0];
      const end = span.get(e.from)?.[1];
      if (start != null && end != null && start <= end)
        out.push(warn('timeline-dependency-order', [e.from, e.to], `"${e.to}" does not start after "${e.from}" ends`));
    }
    if (fig.today != null && dayOf(fig.today) == null) out.push(err('bad-date', [], `today "${fig.today}" is not a real YYYY-MM-DD date`));
  } else if (fig.lanes) {
    const top = fig.layout;
    if (!isLanesLayout(top))
      out.push(err('lanes-need-column', [], 'lanes need a column group of labeled groups, one per lane, with boxes only inside'));
    else {
      const cols = laneColumns(fig);
      for (const lane of top.children as FigGroup[]) {
        const at = new Map<number, string>();
        for (const n of lane.children as FigNode[]) {
          const c = cols.get(n.id)!;
          const other = at.get(c);
          if (other != null)
            out.push(
              warn('lane-column-taken', [other, n.id], `boxes "${other}" and "${n.id}" share column ${c} in lane "${str(lane.label)}"`),
            );
          at.set(c, n.id);
        }
      }
    }
  }
  for (const n of nodes(fig.layout))
    if (n.at != null && !validAt(n.at)) out.push(err('bad-at', [n.id], `box "${n.id}": at ${n.at} is not an integer of 0 or more`));
  return out;
}

export type CheckOptions = { width?: number; minText?: number };

const at = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};
const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
// Margins stop edges along a border and pills edge to edge from counting as touches.
const inside = (p: Pt, r: Rect, pad: number) => p.x > r.x + pad && p.x < r.x + r.w - pad && p.y > r.y + pad && p.y < r.y + r.h - pad;
const overlap = (a: Rect, b: Rect, pad: number) =>
  a.x + pad < b.x + b.w - pad && b.x + pad < a.x + a.w - pad && a.y + pad < b.y + b.h - pad && b.y + pad < a.y + a.h - pad;
const px = (n: number) => Math.round(n * 10) / 10;

export function checkScene(scene: Scene, { width = 830, minText = 10 }: CheckOptions = {}): Finding[] {
  const out: Finding[] = [];
  for (const b of scene.boxes)
    for (const t of b.texts) {
      const need = t.need ?? textWidth(t.text, t.fontSize, t.mono);
      if (need > t.room + 0.5)
        out.push(err('text-overflow', [b.id], `box "${b.id}": "${t.text}" needs ${Math.ceil(need)} px, has ${Math.floor(t.room)} px`));
    }
  for (const e of scene.edges) {
    if (e.behind && !e.elbow) continue;
    const line = e.elbow ?? e.pts;
    const pts = line
      ? line.slice(1).flatMap((q, k) => Array.from({ length: 17 }, (_, i) => lerp(line[k], q, i / 16)))
      : Array.from({ length: 33 }, (_, i) => at(e.curve, i / 32));
    for (const b of scene.boxes)
      if (b.id !== e.from && b.id !== e.to && pts.some((p) => inside(p, b.rect, 2)))
        out.push(err('edge-crosses-box', [e.id, b.id], `edge "${e.id}" passes through box "${b.id}"`));
  }
  const pills = scene.edges.filter((e) => e.pts && e.label);
  const under = new Set<string>();
  for (const e of scene.edges) {
    if (e.behind) continue;
    const pts = e.pts
      ? e.pts.slice(1).flatMap((q, k) => Array.from({ length: 17 }, (_, i) => lerp(e.pts![k], q, i / 16)))
      : Array.from({ length: 33 }, (_, i) => at(e.curve, i / 32));
    for (const f of pills)
      if (f.id !== e.id && !under.has(e.id + ' ' + f.id) && pts.some((p) => inside(p, f.label!, 2))) {
        under.add(e.id + ' ' + f.id);
        out.push(err('label-overlap', [e.id, f.id], `edge "${e.id}" passes under the pill of edge "${f.id}"`));
      }
  }
  const path = (e: SceneEdge) =>
    e.pts
      ? e.pts.slice(1).flatMap((q, k) => Array.from({ length: 17 }, (_, i) => lerp(e.pts![k], q, i / 16)))
      : Array.from({ length: 33 }, (_, i) => at(e.curve, i / 32));
  const stubs = scene.edges.filter((e) => e.pts && e.pts.length > 1);
  const hit = new Set<string>();
  for (const f of stubs)
    for (const e of scene.edges) {
      if (e.behind || e === f || (e.id === f.id && e.pts) || hit.has(f.id + ' ' + e.id)) continue;
      const p = path(e);
      if (f.pts!.slice(1).some((a, k) => p.slice(1).some((b, i) => crosses(f.pts![k], a, p[i], b)))) {
        hit.add(f.id + ' ' + e.id);
        out.push(warn('stub-crosses-edge', [f.id, e.id], `the stub of edge "${f.id}" crosses edge "${e.id}"`));
      }
    }
  for (const f of scene.edges.filter((e) => e.label))
    for (const l of scene.lanes ?? []) {
      const [p, r] = [f.label!, l.rect];
      const inside = p.x >= r.x && p.x + p.w <= r.x + r.w && p.y >= r.y && p.y + p.h <= r.y + r.h;
      if (!inside && overlap(p, r, 0))
        out.push(
          err(
            'label-overlap',
            [f.id],
            f.pts
              ? `the pill of edge "${f.id}" crosses the border of lane "${l.id}"`
              : `the label of edge "${f.id}" crosses the border of lane "${l.id}"`,
          ),
        );
    }
  const labeled = scene.edges.filter((e) => e.label);
  labeled.forEach((e, i) => {
    for (const f of labeled.slice(i + 1))
      if ((e.step == null || f.step == null || e.step === f.step) && overlap(e.label!, f.label!, 1))
        out.push(err('label-overlap', [e.id, f.id], `the labels of edges "${e.id}" and "${f.id}" overlap`));
    for (const b of scene.boxes)
      if (overlap(e.label!, b.rect, 1)) out.push(err('label-overlap', [e.id, b.id], `the label of edge "${e.id}" covers box "${b.id}"`));
  });
  const shown = scene.minFont * Math.min(1, width / scene.width);
  if (shown < minText) out.push(warn('small-text', [], `at ${width} px the smallest text is ${px(shown)} px (minimum ${minText} px)`));
  return out;
}

function rgb(color: string): [number, number, number] | null {
  const s = color.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) {
    const [h, sat, l] = [+m[1] / 360, +m[2] / 100, +m[3] / 100];
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return 255 * (l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [f(0), f(8), f(4)];
  }
  return null;
}
const lum = (c: [number, number, number]) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

/** The WCAG contrast ratio of two colors, rounded to 2 places; null if either cannot be read. */
export function contrast(a: string, b: string): number | null {
  const [x, y] = [rgb(a), rgb(b)];
  if (!x || !y) return null;
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

type Colors = Record<'accent' | 'fg' | 'muted' | 'bg' | 'surface' | 'border', string>;
const PAIRS = [
  ['fg', 'bg'],
  ['muted', 'bg'],
  ['fg', 'surface'],
  ['text', 'accent'],
  ['fg', 'tint'],
  ['muted', 'tint'],
] as const;

function tintOf(t: Colors, color = t.accent, base = t.surface, pct = 10): string {
  const [a, s] = [rgb(color), rgb(base)];
  if (!a || !s) return base;
  return `rgb(${a.map((v, i) => (pct / 100) * v + (1 - pct / 100) * s[i]).join(',')})`;
}

/** Text the reader cannot read: each text and background pair, in light, dark and any custom theme, needs 4.5:1 (WCAG AA). */
export function checkTheme(theme: FigTheme = {}): Finding[] {
  const out: Finding[] = [];
  if (theme.font && theme.font !== 'inherit')
    out.push(warn('font-estimated', [], `theme.font is "${theme.font}"; the SVG check estimates text width for the system font`));
  const custom = Object.keys(theme).some((k) => k !== 'font');
  const sets: [string, Colors][] = [
    ['light', LIGHT],
    ['dark', DARK],
  ];
  if (custom) sets.push(['custom', { ...LIGHT, ...Object.fromEntries(Object.entries(theme).filter(([, v]) => v != null)) } as Colors]);
  const unread = new Set<string>();
  for (const [name, base] of sets) {
    const t = { ...base, tint: tintOf(base) };
    for (const [fg, bg] of PAIRS) {
      const a = fg === 'text' ? ON_ACCENT : t[fg];
      const r = contrast(a, t[bg]);
      if (r == null) {
        for (const c of [a, t[bg]]) if (!rgb(c)) unread.add(c);
      } else if (r < 4.5) out.push(err('low-contrast', [], `${name} theme: ${fg} on ${bg} has contrast ${r}:1 (minimum 4.5:1)`));
    }
    for (const [tname, tone] of Object.entries(TONES)) {
      for (const bg of [tintOf(t, tone, t.bg, 8), tintOf(t, tone, t.surface, 10)]) {
        for (const fg of ['fg', 'muted'] as const) {
          const r = contrast(t[fg], bg);
          if (r != null && r < 4.5)
            out.push(err('low-contrast', [], `${name} theme: ${fg} on the ${tname} box tint has contrast ${r}:1 (minimum 4.5:1)`));
        }
      }
    }
  }
  for (const c of unread) out.push(warn('color-not-checked', [], `cannot read the color "${c}", so its contrast is not checked`));
  return out;
}

export function planFor(fig: FlowProps, opts: SvgOptions): LanePlan | null {
  if (fig.timeline || !fig.lanes || !isLanesLayout(fig.layout)) return null;
  const floor = fig.rail ? (layoutRail(fig, 560)?.width ?? 0) : 0;
  return lanePlan(fig, { width: opts.width, minText: opts.minText, padding: opts.padding ?? 24, floor });
}

export function checkRendered(fig: FlowProps, opts: SvgOptions & CheckOptions, scene: Scene): Finding[] {
  const lost = (planFor(fig, opts)?.lost ?? []).map((id): Finding => ({
    rule: 'lane-end-block',
    severity: 'warning',
    ids: [id],
    message: `edge "${id}" ends at a lane that no block on its side shows; the edge uses the nearest block`,
  }));
  return [...checkSpec(fig), ...checkScene(scene, opts), ...lost, ...checkTheme({ ...fig.theme, ...opts.theme })];
}
