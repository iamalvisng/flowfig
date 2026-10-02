'use client';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { route, type Pt, type Rect, type Routed, type Side } from './geometry.ts';
import { foldedLabel, groupBox, layoutRail, railState, RAIL } from './rail.ts';
import { textWidth } from './text.ts';
import { checkScene, checkSpec, checkTheme } from './check.ts';
import type { Scene } from './scene.ts';
import {
  ASYNC_TAG_W,
  BASE_RATE,
  CARD_LINE,
  CARD_PAD,
  CARD_WIDTH,
  EDGE_OFF,
  EDGE_ON,
  LIGHT,
  TONES,
  ON_ACCENT,
  toneFill,
  toneTint,
  decisions,
  edgeId,
  groupGap,
  isGroup,
  isRows,
  laneColumns,
  LANE_GAP,
  LANE_PAD,
  LANE_ROW_GAP,
  isLanesLayout,
  nodes,
  timelineBeats,
  timelineLayout,
  TL_AXIS_H,
  TL_AXIS_W,
  TL_BAR_H,
  TL_ROW_GAP,
  toBeat,
  beatMs,
  STEP_HOLD_MS,
  playheadItem,
  dateLabelRaised,
  type FigContent,
  type FigGroup,
  type FigNode,
  type FigTheme,
  type FlowProps,
} from './model.ts';

export type * from './model.ts';
export { LIGHT, DARK } from './model.ts';

const DEFAULTS: Required<FigTheme> = { ...LIGHT, font: 'inherit' };
const v = (k: keyof FigTheme) => `var(--fig-${k}, ${DEFAULTS[k]})`;
const MONO = 'var(--ifm-font-family-monospace, ui-monospace, SFMono-Regular, Menlo, monospace)';
const NONE: never[] = []; // a stable default, so a memo keyed on it does not run every render
const ACTIVE = 'flowfig-active'; // the box a packet has just reached
// The active box reads --ff-hop (the tone of the hop that arrived), then --ff-box (the tone of the box), then the accent.
const hue = `var(--ff-hop, var(--ff-box, ${v('accent')}))`;
const glow = `0 0 0 3px color-mix(in srgb, ${hue} 18%, transparent)`;

const cardBody = (c: FigContent): ReactNode => {
  if (c == null) return '—';
  if (!isRows(c)) return c;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'normal' }}>
      {c.map((r, i) => {
        const tone = TONES[r.tone ?? 'blue'];
        const tag = r.tag != null && (
          <span
            data-fig-tag
            style={{
              flexShrink: 0,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.03em',
              textTransform: 'uppercase',
              padding: '0 4px',
              borderRadius: 4,
              lineHeight: '14px',
              color: tone,
              background: `color-mix(in srgb, ${tone} 15%, transparent)`,
            }}
          >
            {r.tag}
          </span>
        );
        const mark = r.mark != null && (
          <span style={{ flexShrink: 0, marginLeft: 'auto', color: v('accent'), fontWeight: 600 }}>{r.mark}</span>
        );
        const text = (
          <span
            style={{
              minWidth: 0,
              fontFamily: r.mono ? MONO : undefined,
              fontSize: r.mono ? 10.5 : undefined,
            }}
          >
            {r.text}
            {r.meta != null && <span style={{ color: v('muted') }}> · {r.meta}</span>}
          </span>
        );
        // A word-sized tag heads its row so the text keeps the full width; a number or no tag sits inline.
        return (r.tag?.length ?? 0) > 2 ? (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
              {tag}
              {mark}
            </div>
            {text}
          </div>
        ) : (
          <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
            {tag}
            {text}
            {mark}
          </div>
        );
      })}
    </div>
  );
};

/**
 * The interactive player for one figure: tabs for the steps, play and pause, speed, hover and full screen.
 * Give it a `FlowProps` spec. Use `toSvg` from `flowfig/svg` for a static animated SVG instead.
 */
export function Flow({
  layout,
  edges,
  steps: stepsIn = NONE,
  theme,
  speed = 900,
  autoplay = true,
  check = false,
  rail: withRail = false,
  lanes,
  timeline,
  today,
}: FlowProps) {
  const tl = timeline && isLanesLayout(layout);
  // A timeline with no steps of its own walks its dated items in date order, with no tab row.
  const synthetic = tl && !stepsIn.length;
  const steps = useMemo(
    () => (synthetic ? timelineBeats({ layout, edges, timeline, today }) : stepsIn),
    [synthetic, layout, edges, timeline, today, stepsIn],
  );
  // The width of the timeline area in px: the server draws TL_AXIS_W, and the browser measures the real width after mount.
  const [axisW, setAxisW] = useState(TL_AXIS_W);
  const area = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [full]);
  const dots = useRef<(SVGGElement | null)[]>([]);
  const chips = useRef<(HTMLDivElement | null)[]>([]);
  const bar = useRef<HTMLDivElement>(null); // the active tab's progress line
  const [beat, setBeat] = useState(0);
  const [holding, setHolding] = useState(false); // the step hold: a timeline's today line rests at today
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const [routed, setRouted] = useState<Routed[]>([]);
  const [active, setActive] = useState<number | null>(steps.length ? 0 : null);
  const [playing, setPlaying] = useState(autoplay);
  // The step's clock lives outside React: pausing freezes it, resizing keeps it, only a new step resets it.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [rate, setRate] = useState<1 | 2>(1);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const clock = useRef<{ beats: unknown; elapsed: number }>({ beats: null, elapsed: 0 });
  const [hover, setHover] = useState<string | null>(null);

  const ids = useMemo(() => edges.map(edgeId), [edges]);
  // A milestone is a diamond too, so its edges meet the tips.
  const tips = useMemo(
    () =>
      new Set([
        ...decisions(layout),
        ...(tl
          ? timelineLayout({ layout, edges, timeline, today }, TL_AXIS_W)
              .items.filter((i) => i.milestone)
              .map((i) => i.id)
          : []),
      ]),
    [layout, tl, edges, timeline, today],
  );
  const step = active == null ? null : steps[active];
  const beats = useMemo(() => (step?.flow ?? []).map(toBeat), [step]);
  // Every content each box's card will ever show. The card is sized to the largest, so text never gets cut and nothing jumps.
  const carded = useMemo(() => {
    const all = new Map<string, FigContent[]>();
    for (const b of steps.flatMap((s) => s.flow.map(toBeat)))
      for (const [id, c] of Object.entries(b.show ?? {})) all.set(id, [...(all.get(id) ?? []), c]);
    return all;
  }, [steps]);
  const cur = beats[beat];
  // The narration: the latest `say` so far (a beat without one keeps the line before), else the step caption.
  const saidAt = beats.slice(0, beat + 1).findLastIndex((b) => b.say != null);
  const said = saidAt === -1 ? step?.caption : beats[saidAt].say;
  // Content cards: everything the step has shown so far, latest wins.
  const shown = useMemo(
    () => Object.assign({}, ...beats.slice(0, beat + 1).map((b) => b.show)) as Record<string, FigContent>,
    [beats, beat],
  );
  // The beat that last changed each card, so only a card whose content just changed animates in.
  const shownAt = useMemo(() => {
    const at: Record<string, number> = {};
    beats.slice(0, beat + 1).forEach((b, i) => Object.keys(b.show ?? {}).forEach((k) => (at[k] = i)));
    return at;
  }, [beats, beat]);

  // The rail lays out in node terms, like the SVG, so both renderers draw the same numbers. Its width follows the measured map.
  const figure = useRef<HTMLElement>(null);
  const [mapW, setMapW] = useState(0);
  const railOnly = withRail === 'only';
  const rail = useMemo(
    () => (withRail ? layoutRail({ layout, edges, steps, rail: true }, railOnly ? 560 : mapW) : null),
    [withRail, railOnly, layout, edges, steps, mapW],
  );
  // 'only' drops the map, but only when the rail has a hop to draw; a figure never renders empty.
  const noMap = railOnly && rail != null;
  const jump = useRef<number | null>(null); // a rail click that asks for a beat of another step
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  // With reduced motion the player shows the last beat, so the rail marks every row as done.
  const [still, setStill] = useState(false);
  useEffect(() => setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  // Boxes with many edges on one side get taller so the edges and their labels have room.
  const minHeight = useMemo(() => {
    const out: Record<string, number> = {},
      inn: Record<string, number> = {};
    for (const e of edges) {
      out[e.from] = (out[e.from] ?? 0) + 1;
      inn[e.to] = (inn[e.to] ?? 0) + 1;
    }
    return (id: string) => {
      const n = Math.max(out[id] ?? 0, inn[id] ?? 0);
      return n > 2 ? n * 30 : undefined;
    };
  }, [edges]);

  // Measure every box and redraw the edges whenever anything changes size.
  useEffect(() => {
    const el = root.current,
      box = outer.current;
    if (!el || !box) return; // no map to measure with rail: 'only'
    const measure = () => {
      // Too wide for its container? Shrink it so the whole figure stays in view. Below half size, scroll instead.
      const scale = Math.max(0.5, Math.min(1, box.clientWidth / el.offsetWidth));
      setFit({ scale, height: el.offsetHeight * scale });
      setMapW(el.offsetWidth);
      if (area.current) setAxisW(area.current.offsetWidth);
      const base = el.getBoundingClientRect();
      const k = base.width / el.offsetWidth; // the scale currently on screen; rects are measured unscaled
      const rects: Record<string, Rect> = {};
      el.querySelectorAll<HTMLElement>('[data-fig]').forEach((n) => {
        const r = n.getBoundingClientRect();
        rects[n.dataset.fig!] = {
          x: (r.left - base.left) / k,
          y: (r.top - base.top) / k,
          w: r.width / k,
          h: r.height / k,
        };
      });
      setRouted(
        route(
          edges.map((e, i) => ({
            id: ids[i],
            from: e.from,
            to: e.to,
            around: e.around,
            ...(tl && { sides: ['r', 'l'] as [Side, Side], elbow: true }),
          })),
          rects,
          tips,
        ),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(box);
    el.querySelectorAll('[data-fig]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [edges, ids, layout, tips, noMap, lanes, tl, axisW]);

  // The same rules as `flowfig check`, on what the browser actually drew: real fonts, real wrapping. Each fault prints once.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    const el = root.current,
      box = outer.current;
    const fig = figure.current;
    // With rail: 'only' there is no map: the figure is the frame and the scene holds only the rail.
    if (!check || !fig || (!noMap && (!el || !box))) return;
    const base = (el ?? fig).getBoundingClientRect();
    const k = el ? base.width / el.offsetWidth : 1;
    const rel = (n: Element): Rect => {
      const r = n.getBoundingClientRect();
      return { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k };
    };
    const boxIds = new Set(nodes(layout).map((n) => n.id));
    const boxes = [...(el ?? fig).querySelectorAll<HTMLElement>('[data-fig]')]
      .filter((n) => boxIds.has(n.dataset.fig!))
      .map((n) => ({
        id: n.dataset.fig!,
        rect: rel(n),
        texts: [...n.querySelectorAll<HTMLElement>('*')]
          .filter((t) => !t.children.length && t.textContent?.trim() && t.clientWidth > 0 && !t.closest('[aria-hidden]'))
          .map((t) => {
            const fontSize = parseFloat(getComputedStyle(t).fontSize);
            return { text: t.textContent!, fontSize, room: t.clientWidth, need: t.scrollWidth };
          }),
      }));
    // Every visible leaf text counts, as in the SVG scene; the 9 px tag pills do not.
    // The rail is a sibling of the map, so the rail queries start at the figure. An SVG <text> has no CSS box, so it skips clientWidth.
    const fonts = [...fig.querySelectorAll<Element>('*')]
      .filter(
        (t) =>
          !t.children.length &&
          t.textContent?.trim() &&
          (t instanceof SVGElement || (t as HTMLElement).clientWidth > 0) &&
          !t.closest('[data-fig-tag],[aria-hidden]'),
      )
      .map((t) => parseFloat(getComputedStyle(t).fontSize));
    const labels = Object.fromEntries([...fig.querySelectorAll<HTMLElement>('[data-fig-label]')].map((n) => [n.dataset.figLabel!, rel(n)]));
    const scene: Scene = {
      width: Math.max(el?.offsetWidth ?? 0, rail?.width ?? 0),
      boxes,
      edges: [
        ...routed.map((r) => {
          const e = edges[ids.indexOf(r.id)];
          return { id: r.id, from: e.from, to: e.to, curve: r.curve, label: labels[r.id], ...(tl && { behind: true as const }) };
        }),
        // A rail pill is a label for label-overlap; its curve is a point at the pill center, so it can cross no box.
        ...(rail?.rows ?? []).flatMap((row) => {
          const r = row.kind === 'message' ? labels[`rail:${row.n}`] : undefined;
          if (row.kind !== 'message' || !r) return [];
          const c: Pt = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
          return [
            {
              id: `rail:${row.n}`,
              step: row.step,
              from: rail!.columns[row.from].id,
              to: rail!.columns[row.to].id,
              curve: [c, c, c, c] as [Pt, Pt, Pt, Pt],
              label: r,
            },
          ];
        }),
      ],
      minFont: Math.min(...fonts),
    };
    for (const f of [
      ...checkSpec({ layout, edges, steps }),
      ...checkScene(scene, { width: (box ?? fig).clientWidth }),
      ...checkTheme(theme),
    ]) {
      const key = f.rule + ':' + f.ids.join() + ':' + f.message;
      if (reported.current.has(key)) continue;
      reported.current.add(key);
      console.warn(`flowfig check: ${f.severity} ${f.rule}: ${f.message}`);
    }
  }, [check, routed, layout, edges, steps, ids, theme, rail, noMap]);

  // Play the step's beats: each moves its packets (and their data cards) along its edges, then the next step starts.
  useEffect(() => {
    const gs = dots.current,
      cs = chips.current,
      edgeOf = Object.fromEntries(edges.map((e, i) => [ids[i], e]));
    if (clock.current.beats !== beats) {
      // A rail click can open another step at a later beat; start the clock at that beat, not at 0.
      const j = jump.current ?? 0;
      jump.current = null;
      clock.current = { beats, elapsed: beats.slice(0, j).reduce((t, b) => t + beatMs(b, speed), 0) };
      setBeat(j);
    }
    if (!beats.length || (!noMap && !routed.length && !(tl && !edges.length))) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (bar.current) bar.current.style.transform = 'none';
      return void setBeat(beats.length - 1);
    }
    const ends = beats.reduce<number[]>((acc, b) => [...acc, (acc.at(-1) ?? 0) + beatMs(b, speed)], []);
    const total = ends.at(-1)! + STEP_HOLD_MS; // The figure holds on the last beat before the next step.
    let raf = 0,
      last = performance.now(),
      shownBeat = -1;
    const tick = (now: number) => {
      if (playingRef.current) clock.current.elapsed += (now - last) * rateRef.current * BASE_RATE;
      last = now;
      if (clock.current.elapsed >= total) {
        if (steps.length > 1) return setActive((a) => ((a ?? 0) + 1) % steps.length);
        clock.current.elapsed = 0;
      }
      const t = clock.current.elapsed;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, t / total)})`;
      const next = ends.findIndex((e) => t < e);
      const i = next === -1 ? beats.length - 1 : next;
      if (i !== shownBeat) setBeat((shownBeat = i));
      setHolding(t >= ends.at(-1)!);
      const start = i ? ends[i - 1] : 0;
      const f = Math.min(1, (t - start) / speed); // the packet crosses in `speed`; the hold gives the rest
      const eased = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      const hops = t < ends.at(-1)! ? beats[i].hops : [];
      gs.forEach((g, j) => {
        const p = hops[j] && paths.current[hops[j].edge];
        const c = cs[j];
        if (!p) {
          if (g) g.style.opacity = '0';
          if (c) c.style.opacity = '0';
          return;
        }
        const pt = p.getPointAtLength((hops[j].back ? 1 - eased : eased) * p.getTotalLength());
        const tone = hops[j].tone && TONES[hops[j].tone!];
        if (g) {
          g.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
          g.style.opacity = '1';
          g.style.color = tone ?? v('accent');
        }
        if (c) {
          c.style.background = tone ? toneFill(tone) : v('accent');
          c.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, calc(-100% - 12px))`;
          c.style.opacity = hops[j].data == null ? '0' : '1';
        }
      });
      // A box is active from the packet arrival to the end of the step hold. The tick toggles the class and skips React.
      const arrived = new Map<string | undefined, string | undefined>();
      if (f >= 1)
        for (const h of beats[i].hops) {
          const to = h.back ? edgeOf[h.edge]?.from : edgeOf[h.edge]?.to;
          arrived.set(to, arrived.get(to) ?? (h.tone && TONES[h.tone]));
        }
      // A focused box turns active at the beat start; in a timeline, when the today line arrives.
      if (t - start >= (tl ? 400 * BASE_RATE : 0)) for (const id of beats[i].focus ?? []) if (!arrived.has(id)) arrived.set(id, undefined);
      root.current?.querySelectorAll<HTMLElement>('[data-fig]').forEach((n) => {
        const on = arrived.has(n.dataset.fig ?? '');
        if (on) {
          const tone = arrived.get(n.dataset.fig);
          if (tone) n.style.setProperty('--ff-hop', tone);
          else n.style.removeProperty('--ff-hop');
        }
        if (on === n.classList.contains(ACTIVE)) return;
        if (!on) return void n.classList.remove(ACTIVE); // the transition fades the box
        // The box turns active at once: no transition while the class arrives.
        const keep = n.style.transition;
        n.style.transition = 'none';
        n.classList.add(ACTIVE);
        void n.offsetWidth;
        n.style.transition = keep;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      root.current?.querySelectorAll(`.${ACTIVE}`).forEach((n) => n.classList.remove(ACTIVE));
      gs.forEach((g) => g && (g.style.opacity = '0'));
      cs.forEach((c) => c && (c.style.opacity = '0'));
    };
  }, [beats, routed, noMap, speed, steps.length]);

  // What to light up: the step's edges and their ends, or whatever touches the hovered box.
  // A step lights the trail so far: every edge its beats have crossed, and every box it has filled.
  const trail = beats.slice(0, beat + 1).flatMap((b) => b.hops.map((h) => h.edge));
  const hoverEdgeIdx = hoverEdge == null ? -1 : ids.indexOf(hoverEdge);
  const litEdges = new Set<string>(
    hoverEdge ? [hoverEdge] : hover ? ids.filter((id, i) => edges[i].from === hover || edges[i].to === hover) : trail,
  );
  const litNodes = new Set<string>(
    hoverEdgeIdx !== -1
      ? [edges[hoverEdgeIdx].from, edges[hoverEdgeIdx].to]
      : hover
        ? [hover]
        : [...(step?.nodes ?? []), ...Object.keys(shown), ...(cur?.light ?? []), ...(cur?.focus ?? [])],
  );
  edges.forEach((e, i) => {
    if (litEdges.has(ids[i])) litNodes.add(e.from).add(e.to);
  });
  // A toned hop colors its edge for its own beat only; the trail after it is the accent.
  const hopTone = (edge: string) => {
    const t = cur?.hops.find((h) => h.edge === edge && h.tone)?.tone;
    return t && TONES[t];
  };
  const goTo = (step: number, b: number) => {
    setPlaying(true);
    if (step === active) {
      clock.current.elapsed = beats.slice(0, b).reduce((t, x) => t + beatMs(x, speed), 0);
      setBeat(b);
    } else {
      jump.current = b;
      setActive(step);
    }
  };
  const focus = hover != null || hoverEdge != null || step != null;

  const vars = Object.fromEntries(Object.entries(theme ?? {}).map(([k, val]) => [`--fig-${k}`, val])) as CSSProperties;

  const timelineFig = useMemo(
    () => (tl ? timelineLayout({ layout, edges, timeline, today }, axisW) : null),
    [tl, layout, edges, timeline, today, axisW],
  );

  // A bar or a milestone of a timeline: placed by the shared layout, with the look of a box.
  const renderBar = (n: FigNode, it: { row: number; x: number; w: number; milestone: boolean; labelInside: boolean }) => {
    const lit = litNodes.has(n.id);
    const bt = n.tone && TONES[n.tone];
    const label = String(n.label);
    const inside = it.labelInside;
    const outside = (
      <span
        style={{ position: 'absolute', left: '100%', marginLeft: 6, whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500, color: v('fg') }}
      >
        {label}
      </span>
    );
    const top = LANE_PAD + it.row * (TL_BAR_H + TL_ROW_GAP);
    return (
      <div
        key={n.id}
        data-fig={n.id}
        data-diamond={it.milestone || undefined}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover(null)}
        style={{
          position: 'absolute',
          left: it.x,
          top: it.milestone ? top + (TL_BAR_H - it.w) / 2 : top,
          width: it.w,
          height: it.milestone ? it.w : TL_BAR_H,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          padding: it.milestone ? 0 : '0 calc(8px - var(--ff-b, 0px))',
          color: v('fg'),
          background: it.milestone ? undefined : bt ? toneTint(bt, v('bg')) : v('bg'),
          border: it.milestone ? undefined : `1px solid ${bt ?? (lit ? v('accent') : v('border'))}`,
          ...(bt && { '--ff-box': bt }),
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          opacity: focus && !lit ? 0.7 : 1,
          transition: 'border-color .4s, background .4s, box-shadow .4s, border-width .4s, padding .4s, opacity .25s',
          cursor: 'default',
        }}
      >
        {it.milestone && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
          >
            <polygon
              points="50,0 100,50 50,100 0,50"
              fill={bt ? toneTint(bt, v('bg')) : v('bg')}
              stroke={bt ?? (lit ? v('accent') : v('border'))}
              strokeWidth={lit ? 1.6 : 1}
              vectorEffect="non-scaling-stroke"
              style={{ transition: 'stroke .4s, fill .4s, stroke-width .4s' }}
            />
          </svg>
        )}
        {inside ? <span style={{ position: 'relative' }}>{label}</span> : outside}
      </div>
    );
  };

  const renderItem = (item: FigNode | FigGroup, depth: number): ReactNode => {
    if (timelineFig && item === layout) {
      const lanesList = layout.children as FigGroup[];
      // The playhead follows the latest dated focus in the step, and rests at the last date before one and in the hold.
      const focused = holding || still ? undefined : playheadItem(timelineFig.items, beats, beat);
      const home = timelineFig.last ?? 0;
      const at = focused ? focused.x + (focused.milestone ? focused.w / 2 : 0) : home;
      const dateText = focused ? focused.date : timelineFig.lastDate;
      const rowsPx = timelineFig.rows.map((r) => r * TL_BAR_H + (r - 1) * TL_ROW_GAP + LANE_PAD * 2);
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `max-content minmax(${TL_AXIS_W}px, 1fr) 18px`,
            // The axis strip sits over the gap above the first band, as in the SVG.
            gridTemplateRows: `${TL_AXIS_H - LANE_ROW_GAP}px ${rowsPx.map((h) => h + 'px').join(' ')}`,
            rowGap: LANE_ROW_GAP,
            position: 'relative',
          }}
        >
          <div data-fig-axis="" style={{ gridColumn: '2 / 4', gridRow: 1, position: 'relative', height: TL_AXIS_H, alignSelf: 'start' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: TL_AXIS_H - 1, height: 1, background: v('border') }} />
            {timelineFig.ticks.map((k) => (
              <Fragment key={k.x}>
                <div style={{ position: 'absolute', left: k.x, top: TL_AXIS_H - 5, width: 1, height: 4, background: v('border') }} />
                <div style={{ position: 'absolute', left: k.x + 3, top: 0, fontSize: 11, lineHeight: '13px', color: v('muted') }}>
                  {k.label}
                </div>
              </Fragment>
            ))}
          </div>
          {lanesList.map((lane, li) => {
            const lit = lane.id != null && litNodes.has(lane.id);
            return (
              <Fragment key={lane.id ?? String(lane.label)}>
                <div
                  data-fig={lane.id}
                  data-fig-lane=""
                  style={{
                    gridColumn: '1 / -1',
                    gridRow: li + 2,
                    background: v('surface'),
                    border: `1px solid ${lit ? v('accent') : v('border')}`,
                    boxShadow: lit ? glow : undefined,
                    transition: 'border-color .25s, box-shadow .25s',
                    borderRadius: 14,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{
                    gridColumn: 1,
                    gridRow: li + 2,
                    alignSelf: 'center',
                    zIndex: 1,
                    padding: '0 18px',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: v('muted'),
                  }}
                >
                  {lane.label}
                </div>
                <div ref={li === 0 ? area : undefined} style={{ gridColumn: 2, gridRow: li + 2, position: 'relative', zIndex: 1 }}>
                  {timelineFig.items
                    .filter((it) => it.track === li)
                    .map((it) =>
                      renderBar(
                        (lane.children as FigNode[]).find((k) => k.id === it.id)!,
                        it,
                      ),
                    )}
                </div>
              </Fragment>
            );
          })}
          {timelineFig.last != null && (
            <div style={{ gridColumn: '2 / 4', gridRow: '1 / -1', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
              {timelineFig.today != null && (
                <div data-fig-today="" style={{ position: 'absolute', left: timelineFig.today, top: 12, bottom: 0, width: 0 }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, borderLeft: `1px dashed ${v('accent')}`, opacity: 0.6 }} />
                  <span
                    style={{
                      position: 'absolute',
                      right: 3,
                      top: -1,
                      fontSize: 11,
                      lineHeight: '11px',
                      fontWeight: 600,
                      color: v('accent'),
                    }}
                  >
                    today
                  </span>
                </div>
              )}
              <div
                data-fig-playhead=""
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 12,
                  bottom: 0,
                  width: 1.5,
                  background: v('accent'),
                  transform: `translateX(${at}px)`,
                  transition: still ? 'none' : 'transform .4s linear',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 3,
                    top: dateLabelRaised(at, timelineFig.today, textWidth(dateText, 11), textWidth('today', 11)) ? -13 : -1,
                    fontSize: 11,
                    lineHeight: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color: v('accent'),
                  }}
                >
                  {dateText}
                </span>
              </div>
            </div>
          )}
        </div>
      );
    }
    if (lanes && item === layout && isLanesLayout(layout)) {
      const cols = laneColumns({ layout, edges, steps, lanes });
      const n = Math.max(0, ...cols.values()) + 1;
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `max-content repeat(${n}, max-content)`,
            columnGap: 0,
            rowGap: LANE_ROW_GAP,
            position: 'relative',
          }}
        >
          {(layout.children as FigGroup[]).map((lane, li) => {
            const lit = lane.id != null && litNodes.has(lane.id);
            return (
              <Fragment key={lane.id ?? String(lane.label)}>
                <div
                  data-fig={lane.id}
                  data-fig-lane=""
                  style={{
                    gridColumn: '1 / -1',
                    gridRow: li + 1,
                    background: v('surface'),
                    border: `1px solid ${lit ? v('accent') : v('border')}`,
                    boxShadow: lit ? glow : undefined,
                    transition: 'border-color .25s, box-shadow .25s',
                    borderRadius: 14,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{
                    gridColumn: 1,
                    gridRow: li + 1,
                    alignSelf: 'center',
                    zIndex: 1,
                    padding: '0 18px',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: v('muted'),
                  }}
                >
                  {lane.label}
                </div>
                {(lane.children as FigNode[]).map((b) => (
                  <div
                    key={b.id}
                    style={{
                      gridColumn: cols.get(b.id)! + 2,
                      gridRow: li + 1,
                      alignSelf: 'center',
                      zIndex: 1,
                      // The last time column keeps the frame side, as in the SVG.
                      padding: `${LANE_PAD}px ${cols.get(b.id) === n - 1 ? 18 : LANE_GAP}px ${LANE_PAD}px 0`,
                    }}
                  >
                    {renderItem(b, 1)}
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
      );
    }
    if (isGroup(item)) {
      const lit = item.id != null && litNodes.has(item.id);
      const framed = item.label != null;
      return (
        <div
          key={item.id ?? depth + String(item.label)}
          data-fig={item.id}
          style={{
            ...(framed && {
              background: v('surface'),
              border: `1px solid ${lit ? v('accent') : v('border')}`,
              boxShadow: lit ? glow : undefined,
              borderRadius: 14,
              padding: '10px 18px 18px',
            }),
            transition: 'border-color .25s, box-shadow .25s',
          }}
        >
          {item.label != null && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                color: v('muted'),
                marginBottom: 12,
              }}
            >
              {item.label}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: item.direction ?? 'row',
              gap: groupGap(item, edges),
              alignItems: item.align
                ? item.align === 'center'
                  ? 'center'
                  : 'flex-' + item.align
                : item.direction === 'column'
                  ? 'stretch'
                  : 'center',
              justifyContent: 'center',
            }}
          >
            {item.children.map((c) => renderItem(c, depth + 1))}
          </div>
        </div>
      );
    }
    const lit = litNodes.has(item.id);
    const diamond = item.shape === 'decision';
    const store = item.shape === 'store';
    const card = carded.has(item.id);
    const bt = item.tone && TONES[item.tone];
    return (
      <div
        key={item.id}
        data-fig={item.id}
        data-diamond={diamond || undefined}
        onMouseEnter={() => setHover(item.id)}
        onMouseLeave={() => setHover(null)}
        style={{
          position: 'relative',
          isolation: 'isolate',
          minWidth: 100,
          maxWidth: card ? undefined : 190,
          width: item.width ?? (card ? CARD_WIDTH : undefined),
          minHeight: minHeight(item.id),
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: diamond
            ? '22px 34px'
            : `calc(${store ? 24 : 10}px - var(--ff-b, 0px)) calc(${card ? 10 : 16}px - var(--ff-b, 0px)) calc(10px - var(--ff-b, 0px))`,
          textAlign: 'center',
          background: diamond ? undefined : bt ? toneTint(bt, v('bg')) : v('bg'),
          color: v('fg'),
          border: diamond ? undefined : `1px solid ${bt ?? (lit ? v('accent') : v('border'))}`,
          ...(bt && { '--ff-box': bt }),
          boxShadow: diamond ? undefined : '0 1px 2px rgba(0,0,0,.06)',
          opacity: focus && !lit ? 0.7 : 1,
          borderRadius: store ? '50% / 12px' : 10,
          fontSize: 14,
          fontWeight: 500,
          transition: 'border-color .4s, background .4s, box-shadow .4s, border-width .4s, padding .4s, opacity .25s',
          cursor: 'default',
        }}
      >
        {diamond && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              zIndex: -1,
            }}
          >
            <polygon
              points="50,0 100,50 50,100 0,50"
              fill={bt ? toneTint(bt, v('bg')) : v('bg')}
              stroke={bt ?? (lit ? v('accent') : v('border'))}
              strokeWidth={lit ? 1.6 : 1}
              vectorEffect="non-scaling-stroke"
              style={{ transition: 'stroke .4s, fill .4s, stroke-width .4s' }}
            />
          </svg>
        )}
        {store && (
          // the cylinder's top rim
          <div
            style={{
              position: 'absolute',
              top: -1,
              left: -1,
              right: -1,
              height: 24,
              boxSizing: 'border-box',
              borderRadius: '50%',
              border: `1px solid ${bt ?? (lit ? v('accent') : v('border'))}`,
              transition: 'border-color .25s',
            }}
          />
        )}
        {item.mark && (
          // the mark sits in the gap; the box border is 1 px, so the offsets add 1
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              boxSizing: 'border-box',
              borderRadius: '50%',
              ...(item.mark === 'start'
                ? { left: -18, width: 10, height: 10, background: bt ?? v('accent') }
                : {
                    right: -20,
                    width: 14,
                    height: 14,
                    border: `1.5px solid ${bt ?? v('accent')}`,
                    background: `radial-gradient(circle, ${bt ?? v('accent')} 0 4px, transparent 4.5px)`,
                  }),
            }}
          />
        )}
        <div>{item.label}</div>
        {item.sub != null && <div style={{ fontSize: 12, fontWeight: 400, color: v('muted'), marginTop: 2 }}>{item.sub}</div>}
        {card && (
          <div
            key={`${active}-${shownAt[item.id] ?? 'empty'}`}
            style={{
              marginTop: 8,
              padding: '6px 8px',
              minHeight: item.lines != null ? item.lines * CARD_LINE + CARD_PAD * 2 + 1 : undefined,
              boxSizing: 'border-box',
              display: 'grid',
              borderRadius: 6,
              textAlign: 'left',
              fontSize: 11,
              lineHeight: '15px',
              fontWeight: 400,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: shown[item.id] != null ? v('fg') : v('muted'),
              background: shown[item.id] != null ? `color-mix(in srgb, ${v('accent')} 8%, ${v('bg')})` : v('surface'),
              border: `1px dashed ${shown[item.id] != null ? v('accent') : v('border')}`,
              animation: shown[item.id] != null ? 'flowfig-in .35s ease-out' : undefined,
            }}
          >
            {/* Invisible copies of every content stack in one grid cell and set the size; the real one sits on top. */}
            {carded.get(item.id)!.map((c, i) => (
              <div key={i} aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
                {cardBody(c)}
              </div>
            ))}
            <div style={{ gridArea: '1 / 1' }}>{cardBody(shown[item.id])}</div>
          </div>
        )}
      </div>
    );
  };

  const iconBtn: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 30,
    height: 30,
    padding: 0,
    borderRadius: 999,
    cursor: 'pointer',
    border: `1px solid ${v('border')}`,
    background: v('bg'),
    color: v('muted'),
  };

  return (
    <figure
      ref={figure}
      className="flowfig"
      style={{
        ...vars,
        position: full ? 'fixed' : 'relative',
        inset: full ? 0 : undefined,
        zIndex: full ? 1000 : undefined,
        overflow: full ? 'auto' : undefined,
        margin: full ? 0 : '24px 0',
        padding: full ? '48px 24px 24px' : '20px 16px 16px',
        border: full ? 'none' : `1px solid ${v('border')}`,
        borderRadius: full ? 0 : 16,
        background: v('bg'),
        fontFamily: v('font'),
        color: v('fg'),
      }}
    >
      <button
        type="button"
        aria-label={full ? 'Close full screen' : 'Full screen'}
        title={full ? 'Close (Esc)' : 'Full screen'}
        onClick={() => setFull((f) => !f)}
        style={{
          ...iconBtn,
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 3,
          width: 28,
          height: 28,
        }}
      >
        <Icon d={full ? 'M4 4l8 8M12 4l-8 8' : 'M9 3h4v4M7 13H3V9M13 3L9 7M3 13l4-4'} />
      </button>
      <style>
        {'@keyframes flowfig-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}' +
          // The active box has a 2 px border, a tint and a glow. The padding shrinks by 1 px. The box size stays the same, so the edges keep their route.
          `.${ACTIVE}:not([data-diamond]){--ff-b:1px;border-width:2px!important;background:color-mix(in srgb, ${hue} 10%, ${v('surface')})!important;box-shadow:${glow}!important;border-color:${hue}!important}` +
          `.${ACTIVE} polygon{fill:color-mix(in srgb, ${hue} 10%, ${v('surface')});stroke:${hue};stroke-width:2px}`}
      </style>
      {!noMap && (
        <>
          {/* The canvas: a dotted grid that runs to the figure's edges, with a line under it. */}
          <div
            style={{
              margin: full ? '-48px -24px 0' : '-20px -16px 0',
              padding: full ? '48px 24px 24px' : '24px 16px',
              borderRadius: full ? 0 : '16px 16px 0 0',
              borderBottom: `1px solid ${v('border')}`,
              backgroundImage: `radial-gradient(color-mix(in srgb, ${v('fg')} 16%, transparent) 1px, transparent 1.2px)`,
              backgroundSize: '14px 14px',
            }}
          >
            {/* ponytail: rows never wrap; wide figures shrink to fit, down to half size. Add a stacked mobile layout if that bites. */}
            <div
              ref={outer}
              style={{
                overflow: fit.scale > 0.5 ? 'hidden' : 'auto',
                height: fit.scale < 1 ? fit.height : undefined,
              }}
            >
              <div
                ref={root}
                style={{
                  position: 'relative',
                  width: 'max-content',
                  margin: '0 auto',
                  transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined,
                  transformOrigin: 'top left',
                  padding: 4,
                  // room for edges that arc over or under the boxes
                  paddingTop: edges.some((e) => e.around === 'above') ? 44 : 4,
                  paddingBottom: edges.some((e) => e.around === 'below') ? 44 : 4,
                }}
              >
                {renderItem(layout, 0)}
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                    pointerEvents: 'none',
                    // A timeline dependency runs under the bars (z-index 1) and over the bands (0).
                    zIndex: tl ? 0 : undefined,
                  }}
                >
                  <defs>
                    {(['off', 'on'] as const).map((k) => (
                      <marker
                        key={k}
                        id={`fig-arrow-${k}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
                      </marker>
                    ))}
                  </defs>
                  {routed.map((r) => {
                    const on = litEdges.has(r.id);
                    const tone = hopTone(r.id);
                    const hidden = !on && edges[ids.indexOf(r.id)].quiet;
                    return (
                      <path
                        key={r.id}
                        ref={(p) => {
                          paths.current[r.id] = p;
                        }}
                        d={r.d}
                        fill="none"
                        stroke={on ? (tone ?? v('accent')) : v('muted')}
                        strokeWidth={on ? EDGE_ON : EDGE_OFF}
                        strokeOpacity={hidden ? 0 : focus && !on ? 0.35 : 1}
                        markerEnd={hidden ? undefined : `url(#fig-arrow-${on ? 'on' : 'off'})`}
                        style={{ transition: 'stroke .25s, stroke-opacity .25s' }}
                      />
                    );
                  })}
                  {Array.from({ length: Math.max(1, ...beats.map((b) => b.hops.length)) }, (_, j) => (
                    <g
                      key={j}
                      ref={(g) => {
                        dots.current[j] = g;
                      }}
                      style={{ opacity: 0, color: v('accent') }}
                    >
                      <circle r={10} fill="currentColor" opacity={0.2} />
                      <circle r={4.5} fill="currentColor" />
                    </g>
                  ))}
                </svg>
                {Array.from({ length: Math.max(1, ...beats.map((b) => b.hops.length)) }, (_, j) => (
                  <div
                    key={j}
                    ref={(c) => {
                      chips.current[j] = c;
                    }}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      zIndex: 2,
                      opacity: 0,
                      maxWidth: 220,
                      width: 'max-content',
                      padding: '4px 9px',
                      borderRadius: 8,
                      fontSize: 11.5,
                      lineHeight: '15px',
                      pointerEvents: 'none',
                      background: v('accent'),
                      color: ON_ACCENT,
                      boxShadow: '0 4px 14px rgba(0,0,0,.18)',
                      transition: 'opacity .2s',
                    }}
                  >
                    {cur?.hops[j]?.data}
                  </div>
                ))}
                {routed.map((r) => {
                  const e = edges[ids.indexOf(r.id)];
                  if (e.label == null || tl) return null;
                  const on = litEdges.has(r.id);
                  const tone = hopTone(r.id);
                  return (
                    <div
                      key={r.id}
                      data-fig-label={r.id}
                      style={{
                        position: 'absolute',
                        left: r.mid.x,
                        top: r.mid.y,
                        transform: 'translate(-50%, -50%)',
                        fontSize: 11,
                        lineHeight: '16px',
                        padding: '0 7px',
                        borderRadius: 999,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        background: on ? (tone ? toneFill(tone) : v('accent')) : v('bg'),
                        color: on ? ON_ACCENT : v('muted'),
                        border: `1px solid ${on ? (tone ?? v('accent')) : v('border')}`,
                        opacity: !on && e.quiet ? 0 : focus && !on ? 0.6 : 1,
                        fontFamily: MONO,
                        transition: 'background .25s, color .25s, opacity .25s',
                      }}
                    >
                      {e.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      {rail && (
        <svg
          viewBox={`0 0 ${rail.width} ${rail.height}`}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: rail.width,
            height: 'auto',
            margin: `${noMap ? 0 : RAIL.gap}px auto 0`,
            overflow: 'visible',
            fontFamily: v('font'),
          }}
        >
          {rail.bands.map((b) => (
            <g key={b.id}>
              <rect x={b.rect.x} y={b.rect.y} width={b.rect.w} height={b.rect.h} rx={10} fill={v('surface')} stroke={v('border')} />
              <text x={b.rect.x + 10} y={b.rect.y + 14} fill={v('muted')} fontSize={11} fontWeight={600} letterSpacing=".04em">
                {b.label.toUpperCase()}
              </text>
            </g>
          ))}
          {rail.columns.map((c) => (
            <text key={c.id} x={c.x} y={rail.head - RAIL.cols / 2 + 4} fill={v('fg')} fontSize={12} fontWeight={500} textAnchor="middle">
              {c.label}
            </text>
          ))}
          {(() => {
            const st = railState(rail, active ?? 0);
            // The lifelines run through the message rows only, so a phase header reads as one clear divider.
            const lines = rail.rows.flatMap((row, i) =>
              row.kind === 'message' && st[i].shown ? rail.columns.map((c) => `M ${c.x} ${st[i].y} V ${st[i].y + RAIL.row}`) : [],
            );
            return <path d={lines.join(' ')} stroke={v('border')} strokeDasharray="2 3" />;
          })()}
          {(() => {
            const st = railState(rail, active ?? 0);
            return rail.rows.map((row, i) => {
              if (!st[i].shown) return null;
              const y = st[i].y;
              if (row.kind === 'phase') {
                const open = !rail.folds || row.step === active;
                const playing =
                  row.step === active ? rail.rows.find((r) => r.kind === 'message' && r.step === active && r.beat === beat) : undefined;
                return (
                  <g key={`p${i}`} style={{ cursor: open ? undefined : 'pointer' }} onClick={open ? undefined : () => goTo(row.step, 0)}>
                    <text x={RAIL.pad} y={y + 19} fill={open ? v('fg') : v('muted')} fontSize={13} fontWeight={600} fontFamily={MONO}>
                      {open ? row.label : foldedLabel(row)}
                    </text>
                    <path d={`M ${open ? row.line.open : row.line.folded} ${y + 15} H ${row.line.end}`} stroke={v('border')} />
                    {playing?.kind === 'message' && (
                      <text x={rail.width - RAIL.pad} y={y + 19} fill={v('muted')} fontSize={11} fontWeight={600} textAnchor="end">
                        {still ? rail.total : playing.n} of {rail.total}
                      </text>
                    )}
                  </g>
                );
              }
              const state = still
                ? 'done'
                : active == null || row.step > active || (row.step === active && row.beat > beat)
                  ? 'next'
                  : row.step === active && row.beat === beat
                    ? 'now'
                    : 'done';
              const on =
                state === 'now' ||
                hoverEdge === row.edge ||
                (hover != null && [rail.columns[row.from].id, rail.columns[row.to].id].includes(hover));
              const [x1, x2] = [rail.columns[row.from].x, rail.columns[row.to].x];
              const ly = y + RAIL.row / 2;
              const tone = state === 'now' && row.tone ? TONES[row.tone] : undefined;
              const g = row.group != null ? rail.groups[row.group] : null;
              return (
                <g
                  key={`m${i}`}
                  data-rail-row={row.n}
                  data-state={state}
                  opacity={state === 'next' && !on ? 0.45 : 1}
                  style={{ cursor: 'pointer' }}
                  onClick={() => goTo(row.step, row.beat)}
                  onMouseEnter={() => setHoverEdge(row.edge)}
                  onMouseLeave={() => setHoverEdge(null)}
                >
                  {g && g.rows[0] === i && (
                    <rect
                      x={groupBox(rail, g).x}
                      y={y + groupBox(rail, g).y}
                      width={groupBox(rail, g).w}
                      height={groupBox(rail, g).h}
                      rx={6}
                      fill={`color-mix(in srgb, ${v('accent')} 8%, ${v('bg')})`}
                      stroke={v('accent')}
                      strokeDasharray="3 3"
                    />
                  )}
                  <path
                    d={`M ${x1} ${ly} H ${x2}`}
                    fill="none"
                    stroke={on ? (tone ?? v('accent')) : v('muted')}
                    strokeWidth={on ? EDGE_ON : EDGE_OFF}
                    strokeDasharray={row.async ? '4 3' : undefined}
                    markerEnd="url(#flowfig-rail-arrow)"
                  />
                  {row.async &&
                    (() => {
                      const tagW = ASYNC_TAG_W;
                      // The tag sits on the tail side of the pill, so it never hides the arrowhead.
                      const tx = !row.pill ? (x1 + x2) / 2 - tagW / 2 : x2 > x1 ? row.pill.x - tagW - 4 : row.pill.x + row.pill.w + 4;
                      return (
                        <>
                          <rect x={tx} y={ly - 6} width={tagW} height={12} rx={4} fill={v('bg')} />
                          <rect x={tx} y={ly - 6} width={tagW} height={12} rx={4} fill={TONES.gray} fillOpacity={0.15} />
                          <text
                            x={tx + tagW / 2}
                            y={ly + 3}
                            fill={TONES.gray}
                            fontSize={9}
                            fontWeight={600}
                            letterSpacing=".03em"
                            textAnchor="middle"
                            data-fig-tag
                          >
                            ASYNC
                          </text>
                        </>
                      );
                    })()}
                  {row.pill && (
                    <g data-fig-label={`rail:${row.n}`}>
                      <rect
                        x={row.pill.x}
                        y={ly - 9}
                        width={row.pill.w}
                        height={18}
                        rx={9}
                        fill={on ? (tone ? toneFill(tone) : v('accent')) : v('bg')}
                        stroke={on ? (tone ?? v('accent')) : v('border')}
                      />
                      <text
                        x={row.pill.x + row.pill.w / 2}
                        y={ly + 4}
                        fill={on ? ON_ACCENT : v('muted')}
                        fontSize={11}
                        fontFamily={MONO}
                        textAnchor="middle"
                      >
                        {row.text}
                      </text>
                    </g>
                  )}
                </g>
              );
            });
          })()}
          <defs>
            <marker
              id="flowfig-rail-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={v('muted')} />
            </marker>
          </defs>
        </svg>
      )}
      {steps.length > 0 && (
        <figcaption style={{ marginTop: 14, textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
            <button
              type="button"
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
              style={iconBtn}
              onClick={() => setPlaying((p) => !p)}
            >
              {/* pause: two bars; play: a triangle */}
              <Icon d={playing ? 'M5.5 4v8M10.5 4v8' : 'M5 3.5v9l7.5-4.5z'} fill={!playing} />
            </button>
            {/* Tabs in a quiet track; the active one carries a progress line for the step that is playing. */}
            {!synthetic && (
              <div
                role="tablist"
                style={{
                  display: 'inline-flex',
                  gap: 2,
                  padding: 3,
                  borderRadius: 10,
                  background: v('surface'),
                  border: `1px solid ${v('border')}`,
                }}
              >
                {steps.map((s, i) => {
                  const on = active === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => {
                        clock.current.elapsed = 0; // replay from the start, even when it is already the active step
                        setActive(i);
                        setPlaying(true);
                        setBeat(0);
                      }}
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        font: 'inherit',
                        fontFamily: MONO,
                        fontSize: 12.5,
                        padding: '5px 14px',
                        borderRadius: 7,
                        border: 'none',
                        cursor: 'pointer',
                        background: on ? v('bg') : 'transparent',
                        color: on ? v('fg') : v('muted'),
                        boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
                        transition: 'background .2s, color .2s',
                      }}
                    >
                      {s.label}
                      {on && (
                        <div
                          ref={bar}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 2,
                            background: v('accent'),
                            transformOrigin: 'left',
                            transform: 'scaleX(0)',
                            opacity: playing ? 1 : 0.35,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              aria-label={`Speed ${rate}×, switch to ${rate === 1 ? 2 : 1}×`}
              title="Playback speed"
              style={{
                ...iconBtn,
                width: 'auto',
                padding: '0 10px',
                font: 'inherit',
                fontFamily: MONO,
                fontSize: 12,
                color: rate === 2 ? v('accent') : v('muted'),
                borderColor: rate === 2 ? v('accent') : v('border'),
              }}
              onClick={() => setRate((r) => (r === 1 ? 2 : 1))}
            >
              {rate}×
            </button>
          </div>
          {said != null && (
            <div
              key={`${active}-${saidAt}`}
              style={{
                marginTop: 12,
                fontSize: 13.5,
                lineHeight: 1.5,
                color: v('muted'),
                minHeight: '3em',
                maxWidth: 640,
                marginInline: 'auto',
                animation: 'flowfig-in .35s ease-out',
              }}
            >
              {said}
            </div>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/** A 16px stroke icon drawn from one SVG path. */
function Icon({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
