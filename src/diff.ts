import {
  edgeId,
  isGroup,
  laneColumns,
  nodes,
  scenes,
  str,
  toBeat,
  type FigNode,
  type FigEdge,
  type FigGroup,
  type FlowProps,
} from './model.ts';

export type Change = {
  kind: 'box' | 'edge' | 'step' | 'message' | 'rail';
  op: 'added' | 'removed' | 'changed';
  id: string;
  detail?: string;
  /** The path line of the level, for a change inside a box. */
  path?: string;
};

const show = (v: unknown) => (v == null ? '(none)' : `"${str(v)}"`);
const fields = <T>(a: T, b: T, names: (keyof T)[]) =>
  names.filter((k) => str(a[k]) !== str(b[k])).map((k) => `${String(k)} ${show(a[k])} -> ${show(b[k])}`);

type Keyed = { path?: string; id?: string };

function compare<T extends Keyed>(
  kind: Change['kind'],
  before: Map<string, T>,
  after: Map<string, T>,
  fieldsOf: (a: T, b: T) => string[],
): Change[] {
  const at = (key: string, v: T): Change => ({ kind, op: 'added', id: v.id ?? key, ...(v.path && { path: v.path }) });
  const out: Change[] = [];
  for (const [key, a] of before) {
    const b = after.get(key);
    if (!b) continue;
    const d = fieldsOf(a, b);
    if (d.length) out.push({ ...at(key, b), op: 'changed', detail: d.join('; ') });
  }
  for (const [key, a] of before) if (!after.has(key)) out.push({ ...at(key, a), op: 'removed' });
  for (const [key, b] of after) if (!before.has(key)) out.push(at(key, b));
  return out;
}

const messages = (fig: FlowProps) => {
  const seen = new Map<string, number>();
  return new Map(
    scenes(fig).flatMap((sc) =>
      (sc.props.steps ?? []).flatMap((s) =>
        s.flow.flatMap((b) =>
          toBeat(b).hops.map((h) => {
            const key = `${str(s.label)}: ${h.edge}${h.back ? ' back' : ''}${h.data != null ? ` "${str(h.data)}"` : ''}${h.tone ? ` [${h.tone}]` : ''}${h.source ? ` <${h.source}>` : ''}${h.via ? ` via ${h.via}` : ''}`;
            const full = `${sc.path.join('>')}\n${key}`;
            const n = (seen.get(full) ?? 0) + 1;
            seen.set(full, n);
            const id = n > 1 ? `${key} #${n}` : key;
            return [`${sc.path.join('>')}\n${id}`, { id, path: sc.line }] as const;
          }),
        ),
      ),
    ),
  );
};

type Box = FigNode & { group?: string; path: string; owner?: string; top?: string };

const boxes = (f: FlowProps) => {
  const m = new Map<string, Box>();
  for (const sc of scenes(f)) {
    const ports = new Set(sc.ports.map((p) => p.id));
    const walk = (g: FigGroup, parent?: string) =>
      g.children.forEach((c) =>
        isGroup(c)
          ? walk(c, c.label != null ? str(c.label) : c.id)
          : ports.has(c.id) || m.set(c.id, { ...c, group: parent, path: sc.line, owner: sc.path.at(-1), top: sc.path[0] }),
      );
    walk(sc.props.layout);
  }
  return m;
};

const BOX_FIELDS: (keyof Box)[] = ['label', 'sub', 'shape', 'tone', 'mark', 'from', 'to', 'source', 'group'];
const touched = (a?: Box, b?: Box) => !a || !b || a.owner !== b.owner || fields(a, b, BOX_FIELDS).length > 0;

export function diff(before: FlowProps, after: FlowProps): Change[] {
  const edges = (f: FlowProps) =>
    new Map(scenes(f).flatMap((sc) => sc.props.edges.map((e) => [edgeId(e), { ...e, path: sc.line }] as const)));
  const steps = (f: FlowProps) =>
    new Map(
      scenes(f).flatMap((sc) =>
        (sc.props.steps ?? []).map((s) => [`${sc.path.join('>')}\n${str(s.label)}`, { ...s, id: str(s.label), path: sc.line }] as const),
      ),
    );
  const was = boxes(before);
  const now = boxes(after);
  const out = [
    ...compare('box', was, now, (a, b) => [
      ...(a.owner !== b.owner ? [`moved from ${a.path || 'the root'} to ${b.path || 'the root'}`] : []),
      ...fields(a, b, BOX_FIELDS),
    ]),
    ...compare('edge', edges(before), edges(after), (a, b) => fields(a, b, ['from', 'to', 'label', 'source', 'via'])),
    ...compare('step', steps(before), steps(after), (a, b) => fields(a, b, ['caption'])),
    ...compare('message', messages(before), messages(after), () => []),
  ];
  const parts = new Map<string, { added: number; removed: number; changed: number }>();
  const tally = (owner: string | undefined, k: 'added' | 'removed' | 'changed') => {
    if (owner) parts.set(owner, { added: 0, removed: 0, changed: 0, ...parts.get(owner), [k]: (parts.get(owner)?.[k] ?? 0) + 1 });
  };
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id);
    const b = now.get(id);
    if (!touched(a, b)) continue;
    if (!a) tally(b!.owner, 'added');
    else if (!b) tally(a.owner, 'removed');
    else {
      tally(b.owner, 'changed');
      if (a.owner !== b.owner) tally(a.owner, 'removed');
    }
  }
  for (const [owner, c] of parts) {
    if (!was.has(owner) || !now.has(owner)) continue;
    const text = `parts: ${c.added} added, ${c.removed} removed, ${c.changed} changed`;
    const hit = out.find((x) => x.kind === 'box' && x.id === owner);
    const path = now.get(owner)!.path;
    if (hit) hit.detail = hit.detail ? `${hit.detail}; ${text}` : text;
    else out.push({ kind: 'box', op: 'changed', id: owner, detail: text, ...(path && { path }) });
  }
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
      const line = `${c.path ? `[${c.path}] ` : ''}${c.kind} ${c.op}: ${id}${c.detail ? ` (${c.detail})` : ''}`;
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
  const rootBoxes = (f: FlowProps) => new Map([...boxes(f)].filter(([, n]) => !n.path));
  const was = rootBoxes(before);
  const now = rootBoxes(after);
  const innerBefore = boxes(before);
  const innerAfter = boxes(after);
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
  for (const id of new Set([...innerBefore.keys(), ...innerAfter.keys()])) {
    const [a, b] = [innerBefore.get(id), innerAfter.get(id)];
    if (touched(a, b)) for (const top of [a?.top, b?.top]) if (top && now.has(top) && !marks.boxes[top]) marks.boxes[top] = 'changed';
  }

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
