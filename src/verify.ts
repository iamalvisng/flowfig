// Code links: a box, an edge or a hop names the code it draws, and `flowfig verify` checks that the code is still there.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { edgeId, nodes, toBeat, type FlowProps } from './model.ts';
import type { Finding } from './scene.ts';

/** `path` or `path#symbol`. No spaces, one `#` at most, both parts non-empty. `null` for a bad form. */
export function parseSource(s: string): { path: string; symbol?: string } | null {
  const m = /^([^\s#]+)(?:#([^\s#]+))?$/.exec(s);
  if (!m) return null;
  return m[2] ? { path: m[1], symbol: m[2] } : { path: m[1] };
}

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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The links against the files under `root`. A path outside the root is a missing file: the figure names the repo, not the disk. */
export function verify(fig: FlowProps, { root = process.cwd() }: { root?: string } = {}): Finding[] {
  const out: Finding[] = [];
  const all = links(fig);
  if (!all.length) return [{ rule: 'no-source', severity: 'warning', ids: [], message: 'no box, edge or hop has a source' }];
  const files = new Map<string, string | null>();
  for (const l of all) {
    const full = resolve(root, l.path);
    const outside = isAbsolute(l.path) || relative(root, full).startsWith('..');
    if (!files.has(full)) files.set(full, !outside && existsSync(full) ? readFileSync(full, 'utf8') : null);
    const text = files.get(full);
    if (text == null) out.push({ rule: 'missing-file', severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: file not found` });
    else if (l.symbol && !new RegExp(`(^|[^\\w$])${escape(l.symbol)}(?![\\w$])`).test(text))
      out.push({ rule: 'missing-symbol', severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: symbol not found` });
  }
  return out;
}
