// No Node import: the React and SVG entries must stay browser-safe.
import { edgeId, nodes, scenes, toBeat, type FlowProps } from './model.ts';

/** `path` or `path#symbol`. No spaces, one `#` at most, both parts non-empty. `null` for a bad form. */
export function parseSource(s: string): { path: string; symbol?: string } | null {
  const m = /^([^\s#]+)(?:#([^\s#]+))?$/.exec(s);
  if (!m) return null;
  return m[2] ? { path: m[1], symbol: m[2] } : { path: m[1] };
}

// GitHub anchor rules: drop other characters, then spaces become hyphens.
export const headingSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');

export type Link = { owner: string; source: string; path: string; symbol?: string; level?: string };

type Owner = [string, string | undefined, string | undefined, string];

export function owners(fig: FlowProps): Owner[] {
  return scenes(fig).flatMap((s) => {
    const ports = new Set(s.ports.map((p) => p.id));
    const at = s.line ? ` [${s.line}]` : '';
    const kind = s.line ? 'part' : 'box';
    return [
      ...nodes(s.props.layout)
        .filter((n) => !ports.has(n.id))
        .map((n): Owner => [`${kind} "${n.id}"${at}`, n.source, undefined, s.path.join('>')]),
      ...s.props.edges.map((e): Owner => [`edge "${edgeId(e)}"${at}`, e.source, e.via, s.path.join('>')]),
      ...(s.props.steps ?? []).flatMap((st) =>
        st.flow.flatMap((b) => toBeat(b).hops.map((h): Owner => [`hop on "${h.edge}"${at}`, h.source, h.via, s.path.join('>')])),
      ),
    ];
  });
}

/** Every well-formed link in the figure, with the box, edge or hop that carries it. `bad-source` covers the rest. */
export function links(fig: FlowProps): Link[] {
  return owners(fig).flatMap(([owner, source, , level]) => {
    const p = source == null ? null : parseSource(source);
    return p ? [{ owner, source: source!, ...p, ...(level && { level }) }] : [];
  });
}
