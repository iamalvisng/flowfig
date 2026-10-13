import { cast, failed, hopsOf, isCheck, moments, question } from './explain.ts';
import { edgeId, isGroup, nodes, str } from './model.ts';
import type { FigLook, FlowProps } from './model.ts';
import { BAR_Y, C, GL, GZ, gateArt, street, truckArt } from './world-art.ts';
import type { Gate, Lot, Pt } from './world-art.ts';

export type Carry = { thing: string; form: 'box' | 'barrel' | 'notes'; count: number; from: number };
export type Hop = { edge: string; from: string; to: string; label: string; data: string; async: boolean; fail: boolean; carry?: Carry };
export type Box = { label: string; actor: number; dead: boolean; check: string };
export type Device = 'phone' | 'cab' | 'antenna';
export type SceneActor = { name: string; look?: FigLook; device: Device; lot: Lot; gate: Gate; port: Pt; checks: boolean };
export type Story = { name: string; moments: Hop[][]; acting: string[]; path: number[] };
export type Scene = {
  svg: string;
  actors: SceneActor[];
  boxes: Record<string, Box>;
  stories: Story[];
  truck: number;
  truckArt: ReturnType<typeof truckArt> | null;
  things: Map<string, { form: Carry['form']; count: number }>;
  keys: ('data' | 'thing' | 'check')[];
};

const FORMS: readonly Carry['form'][] = ['box', 'barrel', 'notes'];
const units = (n?: number) => Math.min(4, Math.max(1, Math.round(n ?? 1)));

export function scene(fig: FlowProps): Scene {
  const cs = cast(fig);
  const all = nodes(fig.layout);
  const byId = new Map(all.map((n) => [n.id, n]));
  const actorOf = new Map(cs.flatMap((a, i) => a.boxes.map((id) => [id, i] as const)));
  const firstBox = new Map<string, string>();
  const walk = (g: FlowProps['layout']) => {
    for (const c of g.children) {
      if (!isGroup(c)) continue;
      const first = nodes(c)[0];
      if (c.id && first) firstBox.set(c.id, first.id);
      walk(c);
    }
  };
  walk(fig.layout);

  const truck = cs.findIndex((a) => a.look === 'truck');
  const devices = cs.map((a, i): Device => (i === truck ? 'cab' : a.look === 'person' || a.look === 'phone' ? 'phone' : 'antenna'));
  const { svg: ground, lots } = street(
    cs.map((a) => a.look),
    devices.map((d) => d === 'antenna'),
  );

  const things: Scene['things'] = new Map();
  for (const e of fig.edges) {
    const c = typeof e.carries === 'object' ? e.carries : undefined;
    if (c && str(c.thing) && !things.has(c.thing))
      things.set(c.thing, { form: FORMS.find((x) => x === c.form) ?? 'box', count: units(c.count) });
  }

  const actors: SceneActor[] = cs.map((a, i) => {
    const device = devices[i];
    const xs = (k: number) => lots[k].hull.map((p) => p[0]);
    const left = Math.min(...xs(i));
    const prev = i > 0 ? Math.max(...xs(i - 1)) : left - 160;
    const sx = left - (device === 'phone' ? Math.min(98, (left - prev) * 0.62) : Math.min(44, (left - prev) * 0.28));
    const d = sx / C + BAR_Y;
    const y = 4.95;
    return {
      name: a.name,
      look: a.look,
      device,
      lot: lots[i],
      gate: { px: d - GL / 2, ex: d + GL / 2, y: BAR_Y, z: GZ, L: GL },
      port: [(left - 22) / C + y, y],
      checks: a.boxes.some((id) => isCheck(byId.get(id))),
    };
  });

  const boxes: Scene['boxes'] = {};
  cs.forEach((a, i) =>
    a.boxes.forEach((id) => {
      const n = byId.get(id);
      if (n) boxes[id] = { label: str(n.label), actor: i, dead: n.tone === 'red' || n.tone === 'gray', check: question(n) };
    }),
  );

  const stories: Story[] = (fig.steps ?? []).map((step) => {
    const label = str(step.label);
    const beats = hopsOf(fig, step);
    const path = new Set<number>();
    const toHop = (h: (typeof beats)[number]['hops'][number]): Hop => {
      const c = typeof h.edge.carries === 'object' && str(h.edge.carries.thing) ? h.edge.carries : undefined;
      const hop: Hop = {
        edge: edgeId(h.edge),
        from: h.source,
        to: h.target,
        label: str(h.edge.label),
        data: str(h.data),
        async: !!h.async,
        fail: failed(byId, h),
      };
      if (c) {
        const origin = c.from ? (byId.has(c.from) ? c.from : firstBox.get(c.from)) : h.source;
        hop.carry = { thing: c.thing, ...things.get(c.thing)!, from: actorOf.get(origin ?? '') ?? -1 };
      }
      for (const a of [actorOf.get(h.source), actorOf.get(h.target), hop.carry?.from]) if (a !== undefined && a >= 0) path.add(a);
      return hop;
    };
    const hops = beats.map((b) => b.hops.map(toHop));
    return { name: label, moments: hops.length ? [...hops, []] : [], acting: moments(fig, label).map((m) => m.actor), path: [...path] };
  });

  const hopsAll = stories.flatMap((s) => s.moments.flat());
  const sides = (h: Hop) => [boxes[h.from]?.actor, boxes[h.to]?.actor];
  const keys: Scene['keys'] = [];
  if (hopsAll.some((h) => !h.carry && new Set(sides(h)).size === 2 && sides(h).every((a) => a !== undefined))) keys.push('data');
  if (hopsAll.some((h) => h.carry)) keys.push('thing');
  if (hopsAll.some((h) => isCheck(byId.get(h.from)))) keys.push('check');

  const art = truck >= 0 ? truckArt(lots[truck].depot!) : null;
  return {
    svg:
      ground +
      actors
        .filter((a) => a.checks)
        .map((a) => gateArt(a.gate))
        .join('') +
      (art?.yard ?? ''),
    actors,
    boxes,
    stories,
    truck,
    truckArt: art,
    things,
    keys,
  };
}
