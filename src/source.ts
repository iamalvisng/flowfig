// No Node import: the React and SVG entries must stay browser-safe.
import { edgeId, nodes, toBeat, type FlowProps } from './model.ts';

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

export type Link = { owner: string; source: string; path: string; symbol?: string };

/** Every box, edge and hop with its raw `source`, well-formed or not. The one owner list that `links` and `checkSpec` share. */
export function owners(fig: FlowProps): [string, string | undefined][] {
  return [
    ...nodes(fig.layout).map((n): [string, string | undefined] => [`box "${n.id}"`, n.source]),
    ...fig.edges.map((e): [string, string | undefined] => [`edge "${edgeId(e)}"`, e.source]),
    ...(fig.steps ?? []).flatMap((s) =>
      s.flow.flatMap((b) => toBeat(b).hops.map((h): [string, string | undefined] => [`hop on "${h.edge}"`, h.source])),
    ),
  ];
}

/** Every well-formed link in the figure, with the box, edge or hop that carries it. `bad-source` covers the rest. */
export function links(fig: FlowProps): Link[] {
  return owners(fig).flatMap(([owner, source]) => {
    const p = source == null ? null : parseSource(source);
    return p ? [{ owner, source: source!, ...p }] : [];
  });
}
