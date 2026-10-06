import {
  edgeId,
  fitCap,
  idsIn,
  isGroup,
  itemWidth,
  nodes,
  toBeat,
  NODE_MAX_W,
  type FigEdge,
  type FigGroup,
  type FigNode,
  type FlowProps,
} from './model.ts';

type Item = FigNode | FigGroup;
type Dir = 'row' | 'column';
type Ctx = { edges: FigEdge[]; at: Map<string, number>; carded: Set<string> };

const PAGE = 830,
  PAD = 24,
  SWEEPS = 8,
  TALL = 2.5,
  // A 20-box chain measures 105 px for each rank.
  RANK_H = 105;

const flat = (it: Item): Item[] => (isGroup(it) && it.label == null && it.id == null ? it.children.flatMap(flat) : [it]);

function seenOrder(fig: FlowProps): Map<string, number> {
  const at = new Map<string, number>();
  const byId = new Map(fig.edges.map((e) => [edgeId(e), e]));
  for (const s of fig.steps ?? [])
    for (const b of s.flow)
      for (const h of toBeat(b).hops) {
        const e = byId.get(h.edge);
        if (e) for (const id of h.back ? [e.to, e.from] : [e.from, e.to]) if (!at.has(id)) at.set(id, at.size);
      }
  for (const n of nodes(fig.layout)) if (!at.has(n.id)) at.set(n.id, at.size);
  return at;
}

function level(items: Item[], dir: Dir, ctx: Ctx): Item[] {
  const n = items.length;
  const unit = new Map<string, number>();
  items.forEach((it, k) => idsIn(it).forEach((id) => unit.set(id, k)));
  const first = items.map((it) => Math.min(...idsIn(it).map((id) => ctx.at.get(id) ?? Infinity)));
  const pairs = ctx.edges.flatMap((e): [number, number, FigEdge][] => {
    const a = unit.get(e.from),
      b = unit.get(e.to);
    return a == null || b == null || a === b ? [] : [[a, b, e]];
  });
  const keys = [...items.keys()].sort((p, q) => first[p] - first[q]);

  const state = Array.from({ length: n }, () => 0);
  const back = new Set<number>();
  const dfs = (u: number) => {
    state[u] = 1;
    const out = [...pairs.keys()].filter((i) => pairs[i][0] === u).sort((i, j) => first[pairs[i][1]] - first[pairs[j][1]]);
    for (const i of out) {
      const v = pairs[i][1];
      if (state[v] === 1) back.add(i);
      else if (state[v] === 0) dfs(v);
    }
    state[u] = 2;
  };
  for (const k of keys) if (!state[k]) dfs(k);
  const dag = pairs.map(([a, b], i): [number, number] => (back.has(i) ? [b, a] : [a, b]));

  const rank = Array.from({ length: n }, () => 0);
  for (let pass = 0; pass < n; pass++) for (const [a, b] of dag) rank[b] = Math.max(rank[b], rank[a] + 1);
  const ranks = Math.max(0, ...rank) + 1;

  const layers: number[][] = Array.from({ length: ranks }, () => []);
  const layerOf = [...rank];
  for (const k of keys) layers[rank[k]].push(k);
  const links: [number, number][] = [];
  const via = dag.map((): number[] => []);
  for (const [i, [a, b]] of dag.entries()) {
    let prev = a;
    for (let r = rank[a] + 1; r < rank[b]; r++) {
      const v = layerOf.length;
      layerOf.push(r);
      layers[r].push(v);
      via[i].push(v);
      links.push([prev, v]);
      prev = v;
    }
    links.push([prev, b]);
  }

  const pos: number[] = [];
  const index = () => layers.forEach((l) => l.forEach((x, i) => (pos[x] = i)));
  const crossings = () => {
    index();
    let c = 0;
    for (let i = 0; i < links.length; i++)
      for (let j = i + 1; j < links.length; j++) {
        const [a, b] = links[i],
          [p, q] = links[j];
        if (layerOf[a] === layerOf[p] && (pos[a] - pos[p]) * (pos[b] - pos[q]) < 0) c++;
      }
    return c;
  };
  let best = layers.map((l) => [...l]);
  let fewest = crossings();
  for (let it = 0; it < SWEEPS; it++) {
    const down = it % 2 === 0;
    const order = [...layers.keys()].slice(1).map((r) => (down ? r : ranks - 1 - r));
    for (const r of order) {
      index();
      const bary = (x: number) => {
        const ns = links.filter(([a, b]) => (down ? b : a) === x).map(([a, b]) => pos[down ? a : b]);
        return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : pos[x];
      };
      const w = new Map(layers[r].map((x) => [x, bary(x)]));
      layers[r].sort((x, y) => w.get(x)! - w.get(y)!);
    }
    const c = crossings();
    if (c < fewest) [fewest, best] = [c, layers.map((l) => [...l])];
  }

  const cross: Dir = dir === 'row' ? 'column' : 'row';
  const built = items.map((it) => (isGroup(it) ? { ...it, direction: dir, children: level(it.children.flatMap(flat), dir, ctx) } : it));
  const beside = new Map<number, number>();
  const unitOf = (k: number): Item => {
    const leaf = beside.get(k);
    if (leaf == null) return built[k];
    const real = best.find((l) => l.includes(k))!.filter((x) => x < n);
    const pair = [built[k], built[leaf]];
    return { direction: 'row', children: real.indexOf(k) < (real.length - 1) / 2 ? pair.reverse() : pair };
  };
  const rankRow = (l: number[]): Item => {
    const real = l.filter((x) => x < n);
    return real.length === 1 ? unitOf(real[0]) : { direction: cross, children: real.map(unitOf) };
  };

  if (dir === 'column') {
    const fits = (l: number[]) => itemWidth(rankRow(l), ctx.carded, ctx.edges, NODE_MAX_W) <= PAGE - 2 * PAD;
    for (const l of best) {
      const leaves = l
        .filter((k) => k < n && !dag.some(([a]) => a === k) && dag.filter(([, b]) => b === k).length === 1)
        .sort((p, q) => first[q] - first[p]);
      for (const k of leaves) {
        if (fits(l)) break;
        const src = dag.find(([, b]) => b === k)![0];
        if (beside.has(src)) continue;
        const home = best.find((m) => m.includes(src))!;
        const i = l.indexOf(k);
        l.splice(i, 1);
        beside.set(src, k);
        if (!fits(home)) {
          beside.delete(src);
          l.splice(i, 0, k);
        }
      }
    }
  }
  const outer = (vs: number[], side: 1 | -1) =>
    vs.every((v) => {
      const l = best[layerOf[v]];
      const k = l.indexOf(v);
      return (side > 0 ? l.slice(k + 1) : l.slice(0, k)).every((x) => x >= n);
    });
  via.forEach((vs, i) => {
    const [a, b] = dag[i];
    const stacked = [a, b].every((k) => best[rank[k]].filter((x) => x < n).length === 1);
    const way =
      !back.has(i) && (!vs.length || stacked) ? undefined : outer([a, ...vs, b], 1) ? 1 : outer([a, ...vs, b], -1) ? -1 : undefined;
    if (way) pairs[i][2].around = dir === 'column' ? (way > 0 ? 'right' : 'left') : way > 0 ? 'below' : 'above';
  });
  const kept = best.filter((l) => l.some((x) => x < n));
  const rows = kept.map(rankRow);
  if (dir === 'row' || kept.length * RANK_H <= TALL * PAGE) return rows;
  const out: Item[] = [];
  let run: Item[] = [];
  const lines = (per: number): Item[] => {
    const k = Math.ceil(run.length / per),
      q = Math.ceil(run.length / k);
    return Array.from({ length: k }, (_, i) => ({ direction: 'row', children: run.slice(i * q, (i + 1) * q) }));
  };
  const flush = () => {
    const folded =
      run.length < 4 ? undefined : [4, 3].map(lines).find((ls) => ls.every((l) => itemWidth(l, ctx.carded, ctx.edges) <= PAGE - 2 * PAD));
    out.push(...(folded ?? run));
    run = [];
  };
  rows.forEach((r, i) => {
    if (kept[i].length === 1 && !isGroup(r)) run.push(r);
    else {
      flush();
      out.push(r);
    }
  });
  flush();
  return out;
}

const pruned = (g: FigGroup): FigGroup => ({
  ...g,
  children: g.children.map((c) => (isGroup(c) ? pruned(c) : c)).filter((c) => !isGroup(c) || c.children.length),
});

export function autoLayout(spec: FlowProps): FlowProps {
  if (spec.lanes || spec.timeline) return spec;
  const fig = { ...spec, layout: pruned(spec.layout) };
  if (!fig.layout.auto) return fig;
  const carded = new Set((fig.steps ?? []).flatMap((s) => s.flow.flatMap((b) => Object.keys(toBeat(b).show ?? {}))));
  const at = seenOrder(fig);
  const items = fig.layout.children.flatMap(flat);
  const make = (direction: Dir): FlowProps => {
    const edges = fig.edges.map((e): FigEdge => ({ ...e, around: undefined }));
    return { ...fig, edges, layout: { direction, children: level(items, direction, { edges, at, carded }) } };
  };
  if (fig.layout.direction) return make(fig.layout.direction);
  const lr = make('row');
  return itemWidth(lr.layout, carded, lr.edges, fitCap(lr, PAGE)) + 2 * PAD <= PAGE ? lr : make('column');
}
