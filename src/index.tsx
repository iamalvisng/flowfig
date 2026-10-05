'use client';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { arcRoom, avoidOf, route, type Pt, type Rect, type Routed, type Side } from './geometry.ts';
import { foldedLabel, groupBox, layoutRail, railState, RAIL } from './rail.ts';
import { textWidth } from './text.ts';
import { checkScene, checkSpec, checkTheme } from './check.ts';
import type { Scene } from './scene.ts';
import {
  ASYNC_TAG_W,
  BASE_RATE,
  CARD_LINE,
  CARD_PAD,
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
  lanePlan as planLanes,
  laneEnd,
  laneBlock,
  STUB_ROOM,
  labelPillW,
  str,
  LANE_BLOCK_GAP,
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
  diamondLines,
  diamondRoom,
  tightCopies,
  nodeWidth,
  labelLines,
  fitCap,
  LABEL_LINE,
  beatMs,
  STEP_HOLD_MS,
  playheadItem,
  loopStartItem,
  dateLabelRaised,
  type FigContent,
  type FigGroup,
  type FigNode,
  type FigTheme,
  type FlowProps,
  edgeTip,
} from './model.ts';

export type * from './model.ts';
export { LIGHT, DARK } from './model.ts';

const DEFAULTS: Required<FigTheme> = { ...LIGHT, font: 'inherit' };
const v = (k: keyof FigTheme) => `var(--fig-${k}, ${DEFAULTS[k]})`;
const MONO = 'var(--ifm-font-family-monospace, ui-monospace, SFMono-Regular, Menlo, monospace)';
const NONE: never[] = [];
const ACTIVE = 'flowfig-active';
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
 * The interactive player for one figure. Give it a `FlowProps` spec.
 * Use `toSvg` from `flowfig/svg` for a static animated SVG.
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
  const synthetic = tl && !stepsIn.length;
  const steps = useMemo(
    () => (synthetic ? timelineBeats({ layout, edges, timeline, today }) : stepsIn),
    [synthetic, layout, edges, timeline, today, stepsIn],
  );
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
  const bar = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  const [holding, setHolding] = useState(false);
  const [returning, setReturning] = useState(false);
  const firstLabel = useRef<string | null>('');
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const [routed, setRouted] = useState<Routed[]>([]);
  const [extraTall, setExtraTall] = useState<ReadonlySet<string>>(new Set());
  const lanePlan = useMemo(
    () =>
      lanes && !tl && isLanesLayout(layout)
        ? planLanes(
            { layout, edges, steps, lanes },
            { floor: withRail ? (layoutRail({ layout, edges, steps, rail: true }, 560)?.width ?? 0) : 0 },
          )
        : null,
    [lanes, tl, layout, edges, steps, withRail],
  );
  const [active, setActive] = useState<number | null>(steps.length ? 0 : null);
  const [playing, setPlaying] = useState(autoplay);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [rate, setRate] = useState<1 | 2>(1);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const clock = useRef<{ beats: unknown; elapsed: number }>({ beats: null, elapsed: 0 });
  const [hover, setHover] = useState<string | null>(null);

  const ids = useMemo(() => edges.map(edgeId), [edges]);
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
  const allBeats = useMemo(() => steps.flatMap((s) => s.flow.map(toBeat)), [steps]);
  const beats = useMemo(() => (step?.flow ?? []).map(toBeat), [step]);
  const cap = useMemo(() => fitCap({ layout, edges, steps, lanes, timeline }, 830), [layout, edges, steps, lanes, timeline]);
  const carded = useMemo(() => {
    const all = new Map<string, FigContent[]>();
    for (const b of steps.flatMap((s) => s.flow.map(toBeat)))
      for (const [id, c] of Object.entries(b.show ?? {})) all.set(id, [...(all.get(id) ?? []), c]);
    return all;
  }, [steps]);
  const cur = beats[beat];
  const saidAt = beats.slice(0, beat + 1).findLastIndex((b) => b.say != null);
  const said = saidAt === -1 ? step?.caption : beats[saidAt].say;
  const shown = useMemo(
    () => Object.assign({}, ...beats.slice(0, beat + 1).map((b) => b.show)) as Record<string, FigContent>,
    [beats, beat],
  );
  const shownAt = useMemo(() => {
    const at: Record<string, number> = {};
    beats.slice(0, beat + 1).forEach((b, i) => Object.keys(b.show ?? {}).forEach((k) => (at[k] = i)));
    return at;
  }, [beats, beat]);

  const figure = useRef<HTMLElement>(null);
  const [mapW, setMapW] = useState(0);
  const railOnly = withRail === 'only';
  const rail = useMemo(
    () => (withRail ? layoutRail({ layout, edges, steps, rail: true }, railOnly ? 560 : mapW) : null),
    [withRail, railOnly, layout, edges, steps, mapW],
  );
  const noMap = railOnly && rail != null;
  const jump = useRef<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

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

  useEffect(() => {
    const el = root.current,
      box = outer.current;
    if (!el || !box) return;
    const measure = () => {
      const scale = Math.max(0.5, Math.min(1, box.clientWidth / el.offsetWidth));
      setFit({ scale, height: el.offsetHeight * scale });
      setMapW(el.offsetWidth);
      if (area.current) setAxisW(area.current.offsetWidth);
      const base = el.getBoundingClientRect();
      // Rects are measured unscaled: k is the scale on screen.
      const k = base.width / el.offsetWidth;
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
      const extra: Rect[] = [];
      el.querySelectorAll<HTMLElement>('[data-fig-outside]').forEach((n) => {
        const r = n.getBoundingClientRect();
        extra.push({ x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k });
      });
      const stubs = lanePlan?.stubs ?? new Map<string, string[]>();
      if (stubs.size)
        el.querySelectorAll<HTMLElement>('[data-fig-gutter]').forEach((n) => {
          const r = n.getBoundingClientRect();
          extra.push({ x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k });
        });
      const avoid = avoidOf(
        nodes(layout).flatMap((n) => (rects[n.id] ? [rects[n.id]] : [])),
        extra,
        stubs.size > 0,
      );
      const bands: Record<string, Rect> = {};
      el.querySelectorAll<HTMLElement>('[data-fig-copy]').forEach((n) => {
        const r = n.getBoundingClientRect();
        bands[n.dataset.figCopy!] = { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k };
      });
      const blockRects = [...el.querySelectorAll<HTMLElement>('[data-fig-block]')].map((n) => n.getBoundingClientRect());
      const pillArea =
        stubs.size && blockRects.length
          ? (() => {
              const [x0, y0] = [Math.min(...blockRects.map((r) => r.left)), Math.min(...blockRects.map((r) => r.top))];
              const [x1, y1] = [Math.max(...blockRects.map((r) => r.right)), Math.max(...blockRects.map((r) => r.bottom))];
              const x = (x0 - base.left) / k + lanePlan!.gutter;
              return { x, y: (y0 - base.top) / k, w: (x1 - base.left) / k - x, h: (y1 - y0) / k };
            })()
          : undefined;
      const laneBands: Record<string, Rect> = {};
      el.querySelectorAll<HTMLElement>('[data-fig-band]').forEach((n) => {
        const r = n.getBoundingClientRect();
        laneBands[n.dataset.figBand!] = { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k };
      });
      const bandOf = (eid: string, id: string, j: 0 | 1): Rect | undefined => {
        const li = layout.children.findIndex((l) => isGroup(l) && (l.id === id || l.children.some((b) => (b as FigNode).id === id)));
        return laneBands[`${li}@${lanePlan?.ends.get(eid)?.[j]}`];
      };
      const end = (eid: string, id: string, start: boolean) =>
        lanePlan ? laneEnd(lanePlan, eid, id, start, (lane, b) => bands[`${lane}@${b}`], rects) : id;
      const next = route(
        edges.map((e, i) => ({
          id: ids[i],
          from: end(ids[i], e.from, true),
          to: end(ids[i], e.to, false),
          around: e.around ?? (lanePlan?.around.has(ids[i]) ? ('below' as const) : undefined),
          ...(tl && { sides: ['r', 'l'] as [Side, Side], elbow: true }),
          ...(stubs.has(ids[i]) && {
            stub: stubs.get(ids[i])!.map(labelPillW),
            bands: [bandOf(ids[i], e.from, 0), bandOf(ids[i], e.to, 1)] as [Rect | undefined, Rect | undefined],
          }),
          ...(!tl && e.label != null && { labelW: labelPillW(str(e.label)) }),
        })),
        rects,
        tips,
        avoid,
        pillArea,
        lanePlan ? { bands: Object.values(laneBands), boxes: nodes(layout).flatMap((n) => (rects[n.id] ? [rects[n.id]] : [])) } : undefined,
      );
      setRouted(next);
      if (lanePlan) {
        const more = [...tightCopies(layout.children as FigGroup[], lanePlan.ends, edges, next)].filter(
          (k) => !lanePlan.tall.has(k) && !extraTall.has(k),
        );
        if (more.length) setExtraTall(new Set([...extraTall, ...more]));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(box);
    el.querySelectorAll('[data-fig]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [edges, ids, layout, tips, noMap, lanes, tl, axisW, lanePlan, extraTall]);

  const reported = useRef(new Set<string>());
  useEffect(() => {
    const el = root.current,
      box = outer.current;
    const fig = figure.current;
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
      .map((n) => {
        const rect = rel(n);
        return {
          id: n.dataset.fig!,
          rect,
          texts: [...n.querySelectorAll<HTMLElement>('*')]
            .filter((t) => !t.children.length && t.textContent?.trim() && t.clientWidth > 0 && !t.closest('[aria-hidden]'))
            .map((t) => {
              const fontSize = parseFloat(getComputedStyle(t).fontSize);
              if (!n.dataset.diamond) return { text: t.textContent!, fontSize, room: t.clientWidth, need: t.scrollWidth };
              const [r, range] = [rel(t), document.createRange()];
              range.selectNodeContents(t);
              const far = Math.max(Math.abs(r.y - rect.y - rect.h / 2), Math.abs(r.y + r.h - rect.y - rect.h / 2));
              return {
                text: t.textContent!,
                fontSize,
                room: diamondRoom(rect.w, rect.h, far),
                need: range.getBoundingClientRect().width / k,
              };
            }),
        };
      });
    const fonts = [...fig.querySelectorAll<Element>('*')]
      .filter(
        (t) =>
          !t.children.length &&
          t.textContent?.trim() &&
          // An SVG <text> has no CSS box, so skip clientWidth.
          (t instanceof SVGElement || (t as HTMLElement).clientWidth > 0) &&
          !t.closest('[data-fig-tag],[aria-hidden]'),
      )
      .map((t) => parseFloat(getComputedStyle(t).fontSize));
    const labels = Object.fromEntries([...fig.querySelectorAll<HTMLElement>('[data-fig-label]')].map((n) => [n.dataset.figLabel!, rel(n)]));
    const lanesIn = el ? [...el.querySelectorAll<HTMLElement>('[data-fig-band]')] : [];
    const scene: Scene = {
      width: Math.max(el?.offsetWidth ?? 0, rail?.width ?? 0),
      boxes,
      ...(lanePlan?.stubs.size && {
        lanes: lanesIn.map((n) => ({
          id: str((layout.children[Number(n.dataset.figBand!.split('@')[0])] as FigGroup).label),
          rect: rel(n),
        })),
      }),
      edges: [
        ...routed.flatMap((r): Scene['edges'] => {
          const e = edges[ids.indexOf(r.id)];
          if (r.stub)
            return r.stub.pts.map((pts, j) => ({ id: r.id, from: e.from, to: e.to, curve: r.curve, pts, label: labels[`${r.id}:${j}`] }));
          return [{ id: r.id, from: e.from, to: e.to, curve: r.curve, label: labels[r.id], ...(tl && { behind: true as const }) }];
        }),
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
      // oxlint-disable-next-line no-console
      console.warn(`flowfig check: ${f.severity} ${f.rule}: ${f.message}`);
    }
  }, [check, routed, layout, edges, steps, ids, theme, rail, noMap, lanePlan]);

  useEffect(() => {
    const gs = dots.current,
      cs = chips.current,
      edgeOf = Object.fromEntries(edges.map((e, i) => [ids[i], e]));
    if (clock.current.beats !== beats) {
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
    const total = ends.at(-1)! + STEP_HOLD_MS;
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
      setReturning(active === steps.length - 1 && t >= total - 400 * BASE_RATE);
      const start = i ? ends[i - 1] : 0;
      const f = Math.min(1, (t - start) / speed);
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
      const arrived = new Map<string | undefined, string | undefined>();
      if (f >= 1)
        for (const h of beats[i].hops) {
          const to = h.back ? edgeOf[h.edge]?.from : edgeOf[h.edge]?.to;
          arrived.set(to, arrived.get(to) ?? (h.tone && TONES[h.tone]));
        }
      if (t - start >= (tl ? 400 * BASE_RATE : 0)) for (const id of beats[i].focus ?? []) if (!arrived.has(id)) arrived.set(id, undefined);
      root.current?.querySelectorAll<HTMLElement>('[data-fig]').forEach((n) => {
        const on = arrived.has(n.dataset.fig ?? '');
        if (on) {
          const tone = arrived.get(n.dataset.fig);
          if (tone) n.style.setProperty('--ff-hop', tone);
          else n.style.removeProperty('--ff-hop');
        }
        if (on === n.classList.contains(ACTIVE)) return;
        if (!on) return void n.classList.remove(ACTIVE);
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

  const renderBar = (n: FigNode, it: { row: number; x: number; w: number; milestone: boolean; labelInside: boolean }) => {
    const lit = litNodes.has(n.id);
    const bt = n.tone && TONES[n.tone];
    const label = String(n.label);
    const inside = it.labelInside;
    const outside = (
      <span
        data-fig-outside=""
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
        title={n.source}
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
      const focused = still
        ? undefined
        : returning
          ? loopStartItem(timelineFig.items, steps)
          : holding
            ? undefined
            : playheadItem(timelineFig.items, beats, beat);
      const home = timelineFig.last ?? 0;
      const at = focused ? focused.x + (focused.milestone ? focused.w / 2 : 0) : home;
      const dateText = focused ? focused.date : timelineFig.lastDate;
      const rowsPx = timelineFig.rows.map((r) => r * TL_BAR_H + (r - 1) * TL_ROW_GAP + LANE_PAD * 2);
      if (firstLabel.current === '') firstLabel.current = dateText;
      else if (firstLabel.current !== dateText) firstLabel.current = null;
      const marks = (front: boolean) =>
        timelineFig.last != null && (
          <div style={{ gridColumn: '2 / 4', gridRow: '1 / -1', position: 'relative', zIndex: front ? 2 : 1, pointerEvents: 'none' }}>
            {timelineFig.today != null && (
              <div
                data-fig-today={front ? undefined : ''}
                style={{ position: 'absolute', left: timelineFig.today, top: 12, bottom: 0, width: 0 }}
              >
                {front ? (
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
                ) : (
                  <div style={{ position: 'absolute', top: 0, bottom: 0, borderLeft: `1px dashed ${v('accent')}`, opacity: 0.6 }} />
                )}
              </div>
            )}
            <div
              data-fig-playhead={front ? undefined : ''}
              style={{
                position: 'absolute',
                left: 0,
                top: 12,
                bottom: 0,
                width: front ? 0 : 1.5,
                background: front ? undefined : v('accent'),
                transform: `translateX(${at}px)`,
                transition: still ? 'none' : 'transform .4s linear',
              }}
            >
              {front && (
                <span
                  key={dateText}
                  style={{
                    position: 'absolute',
                    left: 3,
                    top: dateLabelRaised(at, timelineFig.today, textWidth(dateText, 11), textWidth('today', 11)) ? -13 : -1,
                    fontSize: 11,
                    lineHeight: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color: v('accent'),
                    animation: still || firstLabel.current === dateText ? undefined : 'flowfig-label .4s step-end',
                  }}
                >
                  {dateText}
                </span>
              )}
            </div>
          </div>
        );
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `max-content minmax(${TL_AXIS_W}px, 1fr) 18px`,
            gridTemplateRows: `${TL_AXIS_H - LANE_ROW_GAP}px ${rowsPx.map((h) => h + 'px').join(' ')}`,
            rowGap: LANE_ROW_GAP,
            position: 'relative',
          }}
        >
          {marks(false)}
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
          {marks(true)}
        </div>
      );
    }
    if (lanes && item === layout && isLanesLayout(layout)) {
      const { cols, starts, gaps, lead, blocks, gutter, tall } = lanePlan!;
      const count = blocks.length;
      const grid = (bk: number) => {
        const m = starts[bk + 1] - starts[bk];
        const inBlock = (b: FigNode | FigGroup) => laneBlock(starts, cols.get((b as FigNode).id)!) === bk;
        const shown = (layout.children as FigGroup[]).filter((lane) => count < 2 || lane.children.some(inBlock));
        return (
          <div
            key={bk}
            data-fig-block={bk}
            style={{
              display: 'grid',
              gridTemplateColumns: `${gutter}px repeat(${m}, max-content)${count > 1 ? ' 1fr' : ''}`,
              gridAutoRows: `minmax(${38 + LANE_PAD * 2}px, auto)`,
              columnGap: 0,
              rowGap: LANE_ROW_GAP,
              position: 'relative',
            }}
          >
            {shown.map((lane, li) => {
              const lit = lane.id != null && litNodes.has(lane.id);
              return (
                <Fragment key={lane.id ?? String(lane.label)}>
                  <div
                    data-fig={lane.id}
                    data-fig-copy={lane.id != null ? `${lane.id}@${bk}` : undefined}
                    data-fig-band={`${layout.children.indexOf(lane)}@${bk}`}
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
                    data-fig-gutter=""
                    style={{
                      gridColumn: 1,
                      gridRow: li + 1,
                      alignSelf: 'center',
                      zIndex: 1,
                      padding: '0 18px',
                      whiteSpace: 'nowrap',
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      color: v('muted'),
                    }}
                  >
                    {lane.label}
                  </div>
                  {(lane.children as FigNode[]).filter(inBlock).map((b) => (
                    <div
                      key={b.id}
                      style={{
                        gridColumn: cols.get(b.id)! - starts[bk] + 2,
                        gridRow: li + 1,
                        alignSelf: 'center',
                        zIndex: 1,
                        padding: `${LANE_PAD}px ${gaps[cols.get(b.id)!]}px ${LANE_PAD + (tall.has(`${layout.children.indexOf(lane)}@${bk}`) || extraTall.has(`${layout.children.indexOf(lane)}@${bk}`) ? STUB_ROOM : 0)}px ${cols.get(b.id) === starts[bk] ? lead[bk] : 0}px`,
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
      };
      if (count < 2) return grid(blocks[0]);
      return <div style={{ display: 'flex', flexDirection: 'column', gap: LANE_BLOCK_GAP }}>{blocks.map(grid)}</div>;
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
    const dl = diamond && !card ? diamondLines(item, nodeWidth(item, false) + 70) : null;
    const w = diamond || card || item.width != null || str(item.label) ? nodeWidth(item, card, cap) + (diamond ? 70 : 0) : undefined;
    const lines = w != null && !diamond && str(item.label) ? labelLines(item, w) : null;
    const bt = item.tone && TONES[item.tone];
    return (
      <div
        key={item.id}
        data-fig={item.id}
        title={item.source}
        data-diamond={diamond || undefined}
        onMouseEnter={() => setHover(item.id)}
        onMouseLeave={() => setHover(null)}
        style={{
          position: 'relative',
          isolation: 'isolate',
          minWidth: 100,
          maxWidth: w == null ? cap : undefined,
          width: w,
          minHeight: dl ? Math.max(dl.h, (minHeight(item.id) ?? 0) + 24) : minHeight(item.id),
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
          // The box border is 1 px, so the offsets add 1.
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
        {lines ? (
          lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap', lineHeight: `${LABEL_LINE}px` }}>
              {l}
            </div>
          ))
        ) : (
          <div style={{ lineHeight: `${LABEL_LINE}px` }}>{item.label}</div>
        )}
        {dl
          ? dl.subs.map((l, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 400, color: v('muted'), lineHeight: '15px', whiteSpace: 'nowrap' }}>
                {l.text}
              </div>
            ))
          : item.sub != null && <div style={{ fontSize: 12, fontWeight: 400, color: v('muted'), marginTop: 2 }}>{item.sub}</div>}
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
        {'@keyframes flowfig-label{from{opacity:0}to{opacity:0}}@keyframes flowfig-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}' +
          // The 2 px active border takes 1 px of padding, so the box size stays.
          `.${ACTIVE}:not([data-diamond]){--ff-b:1px;border-width:2px!important;background:color-mix(in srgb, ${hue} 10%, ${v('surface')})!important;box-shadow:${glow}!important;border-color:${hue}!important}` +
          `.${ACTIVE} polygon{fill:color-mix(in srgb, ${hue} 10%, ${v('surface')});stroke:${hue};stroke-width:2px}`}
      </style>
      {!noMap && (
        <>
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
            {/* ponytail: no stacked mobile layout; add one if narrow screens break it. */}
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
                  paddingTop: arcRoom(routed, 'above') || 4,
                  paddingBottom: arcRoom(routed, 'below') || 4,
                  paddingLeft: arcRoom(routed, 'left') || 4,
                  paddingRight: arcRoom(routed, 'right') || 4,
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
                    const tip = edgeTip(r.id, edges[ids.indexOf(r.id)].source, allBeats);
                    const look = (d: string, key: string, guides = false) => (
                      <path
                        key={key}
                        ref={
                          guides
                            ? (p) => {
                                paths.current[r.id] = p;
                              }
                            : undefined
                        }
                        d={d}
                        fill="none"
                        stroke={on ? (tone ?? v('accent')) : v('muted')}
                        strokeWidth={on ? EDGE_ON : EDGE_OFF}
                        strokeOpacity={hidden ? 0 : focus && !on ? 0.35 : 1}
                        markerEnd={hidden ? undefined : `url(#fig-arrow-${on ? 'on' : 'off'})`}
                        style={{ transition: 'stroke .25s, stroke-opacity .25s', pointerEvents: tip ? 'stroke' : undefined }}
                      >
                        {tip && <title>{tip}</title>}
                      </path>
                    );
                    const guide = (
                      <path
                        key={r.id}
                        ref={(p) => {
                          paths.current[r.id] = p;
                        }}
                        d={r.d}
                        fill="none"
                        stroke="none"
                      />
                    );
                    if (r.stub) return [...r.stub.parts.map((d, j) => look(d, `${r.id}:${j}`)), guide];
                    return look(r.d, r.id, true);
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
                {routed.flatMap((r) => {
                  const e = edges[ids.indexOf(r.id)];
                  const texts = r.stub && lanePlan?.stubs.get(r.id);
                  if (!texts && (e.label == null || tl)) return [];
                  const on = litEdges.has(r.id);
                  const tone = hopTone(r.id);
                  const pills = texts
                    ? r.stub!.pills.map((p, j) => ({
                        key: `${r.id}:${j}`,
                        x: p.x + p.w / 2,
                        y: p.y + p.h / 2,
                        text: (j === 0 && r.stub!.short ? texts[2] : texts[j]) as ReactNode,
                      }))
                    : [{ key: r.id, x: r.mid.x, y: r.mid.y, text: e.label }];
                  return pills.map((p) => (
                    <div
                      key={p.key}
                      data-fig-label={p.key}
                      style={{
                        position: 'absolute',
                        left: p.x,
                        top: p.y,
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
                      {p.text}
                    </div>
                  ));
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
              <Icon d={playing ? 'M5.5 4v8M10.5 4v8' : 'M5 3.5v9l7.5-4.5z'} fill={!playing} />
            </button>
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
                        clock.current.elapsed = 0;
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
