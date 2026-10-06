import { edgeId, isGroup, laneColumns, nodes, str, toBeat, type FigNode, type FigEdge, type FigGroup, type FlowProps } from './model.ts';

export type Change = {
  kind: 'box' | 'edge' | 'step' | 'message' | 'rail';
  op: 'added' | 'removed' | 'changed';
  id: string;
  detail?: string;
};

const show = (v: unknown) => (v == null ? '(none)' : `"${str(v)}"`);
const fields = <T>(a: T, b: T, names: (keyof T)[]) =>
  names.filter((k) => str(a[k]) !== str(b[k])).map((k) => `${String(k)} ${show(a[k])} -> ${show(b[k])}`);

function compare<T>(kind: Change['kind'], before: Map<string, T>, after: Map<string, T>, fieldsOf: (a: T, b: T) => string[]): Change[] {
  const out: Change[] = [];
  for (const [id, a] of before) {
    const b = after.get(id);
    if (!b) continue;
    const d = fieldsOf(a, b);
    if (d.length) out.push({ kind, op: 'changed', id, detail: d.join('; ') });
  }
  for (const id of before.keys()) if (!after.has(id)) out.push({ kind, op: 'removed', id });
  for (const id of after.keys()) if (!before.has(id)) out.push({ kind, op: 'added', id });
  return out;
}

const messages = (fig: FlowProps) => {
  const seen = new Map<string, number>();
  const ids = (fig.steps ?? []).flatMap((s) =>
    s.flow.flatMap((b) =>
      toBeat(b).hops.map((h) => {
        const key = `${str(s.label)}: ${h.edge}${h.back ? ' back' : ''}${h.data != null ? ` "${str(h.data)}"` : ''}${h.tone ? ` [${h.tone}]` : ''}${h.source ? ` <${h.source}>` : ''}${h.via ? ` via ${h.via}` : ''}`;
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        return n > 1 ? `${key} #${n}` : key;
      }),
    ),
  );
  return new Map(ids.map((id) => [id, id]));
};

const boxes = (f: FlowProps) => {
  const m = new Map<string, FigNode & { group?: string }>();
  const walk = (g: FigGroup, parent?: string) =>
    g.children.forEach((c) => (isGroup(c) ? walk(c, c.label != null ? str(c.label) : c.id) : m.set(c.id, { ...c, group: parent })));
  walk(f.layout);
  return m;
};

export function diff(before: FlowProps, after: FlowProps): Change[] {
  const edges = (f: FlowProps) => new Map(f.edges.map((e) => [edgeId(e), e]));
  const steps = (f: FlowProps) => new Map((f.steps ?? []).map((s) => [str(s.label), s]));
  const out = [
    ...compare('box', boxes(before), boxes(after), (a, b) =>
      fields(a, b, ['label', 'sub', 'shape', 'tone', 'mark', 'from', 'to', 'source', 'group']),
    ),
    ...compare<FigEdge>('edge', edges(before), edges(after), (a, b) => fields(a, b, ['from', 'to', 'label', 'source', 'via'])),
    ...compare('step', steps(before), steps(after), (a, b) => fields(a, b, ['caption'])),
    ...compare('message', messages(before), messages(after), () => []),
  ];
  // The rail is a boolean or 'only', so str() would hide it.
  if ((before.rail ?? false) !== (after.rail ?? false))
    out.push({ kind: 'rail', op: 'changed', id: 'rail', detail: `${before.rail ?? '(none)'} -> ${after.rail ?? '(none)'}` });
  return out;
}

export function formatDiff(changes: Change[], as: 'text' | 'md'): string {
  if (!changes.length) return as === 'md' ? '- no change in the spec' : 'no change in the spec';
  return changes
    .map((c) => {
      const id = as === 'md' ? `\`${c.id}\`` : c.id;
      const line = `${c.kind} ${c.op}: ${id}${c.detail ? ` (${c.detail})` : ''}`;
      return as === 'md' ? `- ${line}` : line;
    })
    .join('\n');
}

export type DiffMark = 'added' | 'removed' | 'changed';
export type DiffMarks = { boxes: Record<string, DiffMark>; edges: Record<string, DiffMark>; steps: number };

type Item = FigNode | FigGroup;
type Spot = { parent: FigGroup; i: number };

const key = (g: FigGroup) => g.id ?? (g.label != null ? str(g.label) : undefined);
const cloneGroup = (g: FigGroup): FigGroup => ({ ...g, children: g.children.map((c) => (isGroup(c) ? cloneGroup(c) : c)) });
const ids = (g: Item) => (isGroup(g) ? nodes(g).map((n) => n.id) : [g.id]);

function find(root: FigGroup, hit: (c: Item) => boolean): Spot | undefined {
  for (const [i, c] of root.children.entries()) {
    if (hit(c)) return { parent: root, i };
    const inner = isGroup(c) ? find(c, hit) : undefined;
    if (inner) return inner;
  }
}

export function mergeFigures(before: FlowProps, after: FlowProps): { figure: FlowProps; marks: DiffMarks } {
  const was = boxes(before);
  const now = boxes(after);
  const gone = (c: Item) => ids(c).every((id) => !now.has(id));
  const layout = cloneGroup(after.layout);
  const placed = new Set<Item>();

  const locate = (c: Item): Spot | undefined =>
    find(layout, (x) => x === c || (isGroup(c) ? isGroup(x) && key(c) != null && key(x) === key(c) : !isGroup(x) && x.id === c.id));

  const put = (item: Item, frames: FigGroup[], sibs: Item[], at: number) => {
    const sides = [
      ...sibs
        .slice(0, at)
        .reverse()
        .map((s) => [s, 1] as const),
      ...sibs.slice(at + 1).map((s) => [s, 0] as const),
    ];
    const next = after.layout.auto
      ? undefined
      : sides
          .filter(([s]) => placed.has(s) || !gone(s))
          .map(([s, off]) => ({ spot: locate(s), off }))
          .find((x) => x.spot);
    if (next) next.spot!.parent.children.splice(next.spot!.i + next.off, 0, item);
    else {
      const frame = frames.map(locate).find(Boolean);
      (frame ? (frame.parent.children[frame.i] as FigGroup) : layout).children.push(item);
    }
    placed.add(item);
  };

  const walk = (g: FigGroup, frames: FigGroup[]) =>
    g.children.forEach((c, i, sibs) => {
      if (isGroup(c) && !(c.label != null && gone(c) && !locate(c))) walk(c, [c, ...frames]);
      else if (gone(c)) put(c, frames, sibs, i);
    });
  walk(before.layout, [before.layout]);

  const marks: DiffMarks = { boxes: {}, edges: {}, steps: diff(before, after).filter((c) => c.kind !== 'box' && c.kind !== 'edge').length };
  for (const [id, n] of now) {
    const old = was.get(id);
    if (!old) marks.boxes[id] = 'added';
    else if (fields(old, n, ['label', 'sub', 'shape', 'source', 'group']).length) marks.boxes[id] = 'changed';
  }
  for (const id of was.keys()) if (!now.has(id)) marks.boxes[id] = 'removed';

  const colAt = new Map<string, number>();
  if (after.lanes) {
    const colsAfter = laneColumns(after);
    const colsBefore = laneColumns(before);
    const kept = [...now.keys()].filter((id) => was.has(id));
    const slots = new Map<string, { p: number; old: number }>();
    for (const id of was.keys()) {
      if (now.has(id)) continue;
      const old = colsBefore.get(id)!;
      const prev = kept
        .filter((k) => colsBefore.get(k)! < old)
        .sort((a, b) => colsBefore.get(b)! - colsBefore.get(a)! || colsAfter.get(b)! - colsAfter.get(a)!);
      slots.set(id, { p: prev.length ? colsAfter.get(prev[0])! : -1, old });
    }
    const groups = [...new Map([...slots.values()].map((v) => [`${v.p}:${v.old}`, v])).values()].sort((a, b) => a.p - b.p || a.old - b.old);
    for (const id of now.keys()) colAt.set(id, colsAfter.get(id)! + groups.filter((g) => g.p < colsAfter.get(id)!).length);
    for (const [id, v] of slots) {
      const i = groups.findIndex((g) => g.p === v.p && g.old === v.old);
      colAt.set(id, v.p + 1 + groups.filter((g) => g.p < v.p).length + groups.slice(0, i).filter((g) => g.p === v.p).length);
    }
  }
  const paint = (g: FigGroup): FigGroup => ({
    ...g,
    children: g.children.map((c) => {
      if (isGroup(c)) return paint(c);
      const n = { ...c };
      delete n.tone;
      if (after.lanes) n.at = colAt.get(c.id);
      const old = was.get(c.id);
      if (marks.boxes[c.id] === 'changed' && old) {
        if (str(old.label) !== str(c.label)) n.sub = `was "${str(old.label)}"`;
        else if (old.group !== now.get(c.id)!.group) n.sub = old.group != null ? `was in "${old.group}"` : 'moved';
      }
      return n;
    }),
  });

  const oldEdges = new Map(before.edges.map((e) => [edgeId(e), e]));
  const newEdges = new Map(after.edges.map((e) => [edgeId(e), e]));
  const same = (a: FigEdge, b?: FigEdge) => b != null && a.from === b.from && a.to === b.to;
  const edges: FigEdge[] = after.edges.map((e) => {
    const id = edgeId(e);
    const old = oldEdges.get(id);
    if (!same(e, old)) marks.edges[id] = 'added';
    else if (fields(old!, e, ['label', 'source']).length) {
      marks.edges[id] = 'changed';
      if (str(old!.label) !== str(e.label) && old!.label != null)
        return { ...e, label: e.label != null ? `${str(e.label)} (was ${str(old!.label)})` : `(was ${str(old!.label)})` };
    }
    return e;
  });
  for (const [id, e] of oldEdges) {
    if (same(e, newEdges.get(id))) continue;
    const mid = newEdges.has(id) ? `${id} (old)` : id;
    marks.edges[mid] = 'removed';
    const gone = { ...e, id: mid };
    delete gone.around;
    edges.push(gone);
  }

  const figure: FlowProps = { ...after, layout: paint(layout), edges };
  delete figure.steps;
  delete figure.rail;
  return { figure, marks };
}
