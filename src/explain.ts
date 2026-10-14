import { edgeId, isGroup, isLanesLayout, nodes, str, toBeat } from './model.ts';
import type { FigGroup, FigLook, FigNode, FigTone, FlowProps } from './model.ts';

export type Actor = { name: string; look?: FigLook; boxes: string[] };
export type Moment = {
  actor: string;
  say: string;
  note: string;
  stamp?: { mark: '✓' | '✗'; label: string };
  question?: string;
  records: string[];
  summary?: { outcome: string; notReached: string[] };
};

const CAST_MAX = 6;

const isStore = (n: FigNode) => n.shape === 'store';
const isDecision = (n?: FigNode) => n?.shape === 'decision';
const dead = (t?: FigTone) => t === 'red' || t === 'gray';
type Hop = ReturnType<typeof hopsOf>[number]['hops'][number];
export const isCheck = (n?: FigNode) => !!n && (n.shape === 'decision' || !!n.check);
export const question = (n: FigNode) => n.check || (n.shape === 'decision' ? str(n.label) : '');
export const failed = (byId: Map<string, FigNode>, h: Hop) =>
  isCheck(byId.get(h.source)) && (dead(byId.get(h.target)?.tone) || h.tone === 'red');

const labeledTop = (g: FigGroup): FigGroup[] => g.children.flatMap((c) => (!isGroup(c) ? [] : c.label != null ? [c] : labeledTop(c)));

export const hopsOf = (fig: FlowProps, step: { flow: Parameters<typeof toBeat>[0][] }) => {
  const byId = new Map(fig.edges.map((e) => [edgeId(e), e]));
  return step.flow.map((b) => {
    const beat = toBeat(b);
    const hops = beat.hops.flatMap((h) => {
      const edge = byId.get(h.edge);
      return edge ? [{ ...h, edge, source: h.back ? edge.to : edge.from, target: h.back ? edge.from : edge.to }] : [];
    });
    return { beat, hops };
  });
};

export function cast(fig: FlowProps): Actor[] {
  const all = nodes(fig.layout);
  const stores = all.filter(isStore);
  const byId = new Map(all.map((n) => [n.id, n]));
  const groups = fig.lanes && isLanesLayout(fig.layout) ? fig.layout.children.filter(isGroup) : labeledTop(fig.layout);
  let actors: Actor[] = [];
  for (const g of groups) {
    const boxes = nodes(g).filter((n) => !isStore(n));
    if (boxes.length) actors.push({ name: str(g.label), look: g.look, boxes: boxes.map((n) => n.id) });
  }
  if (actors.length) {
    const owned = new Set(actors.flatMap((a) => a.boxes));
    for (const step of fig.steps ?? [])
      for (const { hops } of hopsOf(fig, step))
        for (const id of hops.flatMap((h) => [h.source, h.target])) {
          const n = byId.get(id);
          if (!n || owned.has(id) || isStore(n) || isDecision(n)) continue;
          owned.add(id);
          actors.push({ name: str(n.label), look: n.look, boxes: [id] });
        }
    const rank = new Map(all.map((n, i) => [n.id, i]));
    actors.sort((a, b) => rank.get(a.boxes[0])! - rank.get(b.boxes[0])!);
  }
  if (!actors.length) {
    const seen = new Set<string>();
    for (const step of fig.steps ?? [])
      for (const { hops } of hopsOf(fig, step))
        for (const h of hops)
          for (const id of [h.source, h.target]) if (byId.has(id) && !isStore(byId.get(id)!) && !isDecision(byId.get(id))) seen.add(id);
    actors = [...seen].slice(0, stores.length ? CAST_MAX - 1 : CAST_MAX).map((id) => {
      const n = byId.get(id)!;
      return { name: str(n.label), look: n.look, boxes: [id] };
    });
  }
  if (stores.length) actors.push({ name: 'Records', look: stores.find((s) => s.look)?.look, boxes: stores.map((s) => s.id) });
  return actors;
}

export function moments(fig: FlowProps, step: string): Moment[] {
  const s = fig.steps?.find((x) => str(x.label) === step);
  if (!s) return [];
  const actors = cast(fig);
  const byId = new Map(nodes(fig.layout).map((n) => [n.id, n]));
  const actorOf = new Map(actors.flatMap((a) => a.boxes.map((id) => [id, a.name] as const)));
  const groupLabels = new Map<string, unknown>();
  const walk = (g: FigGroup) => {
    for (const c of g.children) {
      if (!isGroup(c)) continue;
      if (c.id) groupLabels.set(c.id, c.label);
      walk(c);
    }
  };
  walk(fig.layout);
  const labelOf = (id: string) => str(byId.get(id)?.label ?? groupLabels.get(id));
  const beats = hopsOf(fig, s);
  if (!beats.length) return [];

  const last = beats.flatMap((b) => b.hops).at(-1);
  const outcome = last ? labelOf(last.target) : '';

  let prev = actors[0]?.name ?? '';
  const out: Moment[] = beats.map(({ beat, hops }, i) => {
    const end = hops.at(-1);
    const own = (id: string) => actorOf.get(id) ?? labelOf(id);
    const actor = !end ? prev : actorOf.has(end.target) || !isDecision(byId.get(end.target)) ? own(end.target) : i ? prev : own(end.source);
    prev = actor;
    const labels = hops.map((h) => str(h.edge.label)).filter(Boolean);
    const say = str(beat.say) || (end ? (labels.length ? `${labels.join(', ')}: ${labelOf(end.target)}` : labelOf(end.target)) : '');
    const moment: Moment = { actor, say, note: str(beat.note), records: [] };
    const asks = hops.filter((h) => isCheck(byId.get(h.source)));
    const ask = asks.find((h) => failed(byId, h)) ?? asks.at(-1);
    if (ask) {
      moment.stamp = { mark: failed(byId, ask) ? '✗' : '✓', label: str(ask.edge.label) };
      moment.question = question(byId.get(ask.source)!);
    }
    for (const h of hops) {
      const store = byId.get(h.target);
      if (store && isStore(store)) moment.records.push(str(h.data) || str(h.edge.label) || str(store.label));
    }
    return moment;
  });

  const mine = new Set(beats.flatMap((b) => b.hops.flatMap((h) => [h.source, h.target])));
  const refusal = beats.flatMap((b) => b.hops).find((h) => failed(byId, h));
  const order: string[] = [];
  if (refusal) {
    const live = fig.edges.filter((e) => e !== refusal.edge && byId.has(e.to) && !dead(byId.get(e.to)!.tone));
    const reach = new Set([refusal.source]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of live)
        if (reach.has(e.from) && !reach.has(e.to)) {
          reach.add(e.to);
          grew = true;
        }
    }
    const inner = live.filter((e) => reach.has(e.from) && reach.has(e.to) && e.to !== refusal.source);
    const need = new Map<string, number>();
    for (const e of inner) need.set(e.to, (need.get(e.to) ?? 0) + 1);
    for (const queue = [refusal.source]; queue.length;) {
      const id = queue.shift()!;
      order.push(id);
      for (const e of inner) {
        if (e.from !== id) continue;
        need.set(e.to, need.get(e.to)! - 1);
        if (!need.get(e.to)) queue.push(e.to);
      }
    }
    for (const id of reach) if (!order.includes(id)) order.push(id);
  }
  const notReached = order
    .slice(1)
    .filter((id) => !mine.has(id))
    .map(labelOf);

  out.forEach((m, i) => {
    const next = out.slice(i + 1).find((o) => o.actor !== m.actor);
    if (!m.note && next) m.note = `${next.actor} acts next.`;
  });
  out.push({
    actor: out.at(-1)!.actor,
    say: s.outcome || (/[.?!]$/.test(outcome) ? outcome : `${outcome}.`),
    note: '',
    records: [],
    summary: { outcome, notReached },
  });
  return out;
}

const PLACES: readonly (FigLook | undefined)[] = ['person', 'shop', 'truck'];

export const worldReady = (fig: FlowProps) =>
  fig.edges.some((e) => !!e.carries && typeof e.carries === 'object') || cast(fig).some((a) => PLACES.includes(a.look));
