import { edgeId, isGroup, str, toBeat, type FigNode, type FigEdge, type FigGroup, type FlowProps } from './model.ts';

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

export function diff(before: FlowProps, after: FlowProps): Change[] {
  const boxes = (f: FlowProps) => {
    const m = new Map<string, FigNode & { group?: string }>();
    const walk = (g: FigGroup, parent?: string) =>
      g.children.forEach((c) => (isGroup(c) ? walk(c, c.label != null ? str(c.label) : c.id) : m.set(c.id, { ...c, group: parent })));
    walk(f.layout);
    return m;
  };
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
