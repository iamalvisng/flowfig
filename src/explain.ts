import { edgeId, isGroup, isLanesLayout, nodes, str, toBeat } from './model.ts';
import type { FigGroup, FigLook, FigNode, FlowProps } from './model.ts';

export type Actor = { name: string; look?: FigLook; boxes: string[] };
export type Moment = {
  actor: string;
  say: string;
  note: string;
  stamp?: { mark: '✓' | '✗'; label: string };
  records: string[];
  summary?: { outcome: string; notReached: string[] };
};

const CAST_MAX = 6;

const isStore = (n: FigNode) => n.shape === 'store';
const isDecision = (n?: FigNode) => n?.shape === 'decision';

const labeledTop = (g: FigGroup): FigGroup[] => g.children.flatMap((c) => (!isGroup(c) ? [] : c.label != null ? [c] : labeledTop(c)));

const hopsOf = (fig: FlowProps, step: { flow: Parameters<typeof toBeat>[0][] }) => {
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

  const sources = new Set(beats.flatMap((b) => b.hops.map((h) => h.source)));
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
    if (end && byId.get(end.source)?.shape === 'decision') {
      const dead =
        end === last && !sources.has(end.target) && [byId.get(end.target)?.tone, end.tone].some((t) => t === 'red' || t === 'gray');
      moment.stamp = { mark: dead ? '✗' : '✓', label: str(end.edge.label) };
    }
    for (const h of hops) {
      const store = byId.get(h.target);
      if (store && isStore(store)) moment.records.push(str(h.data) || str(h.edge.label) || str(store.label));
    }
    return moment;
  });

  const visited = (of: typeof beats) => of.flatMap((b) => b.hops.flatMap((h) => [h.source, h.target]));
  const mine = new Set(visited(beats));
  const first = new Set<string>();
  for (const st of fig.steps ?? []) for (const id of visited(hopsOf(fig, st))) if (byId.has(id)) first.add(id);
  const notReached = [...new Set([...first].filter((id) => !mine.has(id)).map(labelOf))];

  out.forEach((m, i) => {
    const next = out.slice(i + 1).find((o) => o.actor !== m.actor);
    if (!m.note) m.note = next ? `Next: ${next.actor}` : `Outcome: ${outcome}`;
  });
  out.push({
    actor: out.at(-1)!.actor,
    say: `End of "${step}"`,
    note: `Outcome: ${outcome}`,
    records: [],
    summary: { outcome, notReached },
  });
  return out;
}
