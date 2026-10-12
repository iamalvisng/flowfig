import { resolve } from 'node:path';
import { edgeId, nodes, scenes, toBeat, type FigEdge, type FlowProps } from './model.ts';
import { headingSlug, links } from './source.ts';
import type { Finding } from './scene.ts';
import { codeFile, isDefined, outside, readFile, type CodeFile, type Read } from './code.ts';
import { edgeResult, type EdgeResult } from './edges.ts';
import { reexports } from './imports.ts';

export { parseSource, headingSlug, owners, links, type Link } from './source.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const defines = (
  root: string,
  file: CodeFile | null,
  symbol: string,
  read: Read,
  cache: Map<string, CodeFile | null>,
  depth = 0,
): boolean | null => {
  if (!file || depth > 5) return null;
  if (isDefined(file, symbol)) return true;
  let doubt = false;
  for (const [path, inner] of reexports(root, file, symbol, read)) {
    const target = path == null || inner === '?' ? null : codeFile(root, path, read, cache);
    const r = inner === '*' ? (target ? true : null) : defines(root, target, inner, read, cache, depth + 1);
    if (r) return true;
    if (r == null) doubt = true;
  }
  return doubt ? null : false;
};

const hasHeading = (text: string, slug: string) =>
  text.split('\n').some((line) => {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    return m != null && headingSlug(m[1]) === slug;
  });

export type Coverage = {
  boxes: number;
  boxesDefined: number;
  found: number;
  notFound: number;
  unsure: number;
  notChecked: number;
  unsureEdges: { id: string; reason: string }[];
  /** The coverage of each level inside a box, by path line. */
  levels?: { path: string; coverage: Coverage }[];
};

const emptyCoverage = (): Coverage => ({ boxes: 0, boxesDefined: 0, found: 0, notFound: 0, unsure: 0, notChecked: 0, unsureEdges: [] });

export const coverageLine = (figure: string, c: Coverage) =>
  `${figure}: ${c.boxesDefined} of ${c.boxes} boxes defined` +
  (c.found + c.notFound + c.unsure + c.notChecked
    ? `; edges: ${c.found} found, ${c.notFound} not found, ${c.unsure} unsure, ${c.notChecked} not checked`
    : '');

export const levelLines = (c: Coverage) =>
  (c.levels ?? []).map(
    ({ path, coverage: l }) =>
      `[${path}] ${l.boxesDefined} of ${l.boxes} parts defined; edges: ${l.found} found, ${l.notFound} not found, ${l.unsure} unsure, ${l.notChecked} not checked`,
  );

export const unsureLines = (c: Coverage) => c.unsureEdges.map((e) => `unsure   edge "${e.id}": ${e.reason}`);

export const SPEC_MARK = '<metadata id="figure-spec">';

export function detailFindings(fig: FlowProps, root: string, read: Read = readFile): Finding[] {
  return nodes(fig.layout).flatMap((n) => {
    if (typeof n.detail !== 'string') return [];
    const text = outside(root, n.detail) ? null : read(resolve(root, n.detail));
    const why = text == null ? 'file not found' : text.includes(SPEC_MARK) ? '' : 'no figure spec in the file';
    return why
      ? [{ rule: 'missing-detail', severity: 'warning' as const, ids: [n.id], message: `box "${n.id}" -> ${n.detail}: ${why}` }]
      : [];
  });
}

/** The links against the files under `root`. A path outside `root` counts as a missing file. */
export function verifyReport(
  fig: FlowProps,
  {
    root = process.cwd(),
    read = readFile,
    cache = new Map<string, CodeFile | null>(),
  }: { root?: string; read?: Read; cache?: Map<string, CodeFile | null> } = {},
): { findings: Finding[]; coverage: Coverage } {
  const findings: Finding[] = [];
  const coverage = emptyCoverage();
  findings.push(...detailFindings(fig, root, read));
  const linked = links(fig);
  if (!linked.length)
    return {
      findings: [...findings, { rule: 'no-source', severity: 'warning', ids: [], message: 'no box, edge or hop has a source' }],
      coverage,
    };
  const files = new Map<string, string | null>();
  const levels: { path: string; coverage: Coverage }[] = [];
  const all = scenes(fig);
  const byKey = new Map(all.map((s) => [s.path.join('>'), s]));
  const sourceOf = new Map(all.flatMap((s) => nodes(s.props.layout).map((n) => [n.id, n.source] as const)));
  for (const scene of all) {
    const level = emptyCoverage();
    for (const l of linked.filter((x) => (x.level ?? '') === scene.path.join('>'))) {
      const full = resolve(root, l.path);
      if (!files.has(full)) files.set(full, outside(root, l.path) ? null : read(full));
      const text = files.get(full);
      const before = findings.length;
      let doubt = false;
      const fail = (rule: string, what: string) =>
        findings.push({ rule, severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: ${what}` });
      if (text == null) fail('missing-file', 'file not found');
      else if (l.symbol) {
        const code = codeFile(root, l.path, read, cache);
        if (code) {
          const r = defines(root, code, l.symbol, read, cache);
          if (r === false) fail('missing-symbol', 'symbol not defined');
          doubt = r == null;
        } else if (
          !new RegExp(`(^|[^\\w$])${escape(l.symbol)}(?![\\w$])`).test(text) &&
          !(/\.(md|markdown)$/i.test(l.path) && hasHeading(text, l.symbol))
        )
          fail('missing-symbol', 'symbol not found');
      }
      if (l.owner.startsWith('box "') || l.owner.startsWith('part "')) {
        level.boxes++;
        if (findings.length === before && !doubt) level.boxesDefined++;
      }
    }
    const props = scene.props;
    const source = new Map(nodes(props.layout).map((n) => [n.id, n.source]));
    const call = (caller?: string, callee?: string, via?: string): { result: EdgeResult; reason: string } =>
      caller ? edgeResult(root, caller, callee, via, read, cache) : { result: 'not-checked', reason: '' };
    const ports = new Set(scene.ports.map((p) => p.id));
    const edgeCall = (e: FigEdge) => {
      const direct = call(e.source ?? source.get(e.from), source.get(e.to), e.via);
      const into = ports.has(e.from);
      if (direct.result === 'found' || e.source != null || e.via != null || into === ports.has(e.to)) return direct;
      const n = into ? e.from : e.to;
      const chains = [];
      const inner: [string | undefined, string | undefined][] = [];
      let callee = source.get(into ? e.to : e.from);
      for (let k = scene.path.length; k > 0 && byKey.get(scene.path.slice(0, k).join('>'))!.ports.some((p) => p.id === n); k--) {
        const owner = sourceOf.get(scene.path[k - 1]);
        inner.push([owner, callee]);
        callee = owner;
        chains.push([...inner, into ? [source.get(n), owner] : [owner, source.get(n)]].map(([a, b]) => call(a, b)));
      }
      if (chains.some((c) => c.every((r) => r.result === 'found'))) return { result: 'found' as const, reason: '' };
      for (const r of ['not-found', 'not-checked'] as const)
        if (direct.result === r && chains.every((c) => c.some((x) => x.result === r))) return direct;
      const doubt = [direct, ...chains.flat()].find((r) => r.result === 'unsure');
      return {
        result: 'unsure' as const,
        reason: doubt?.reason ?? `${direct.reason}; the call through box "${scene.path.at(-1)}" is not checked`,
      };
    };
    const check = (who: string, id: string, { result, reason }: { result: EdgeResult; reason: string }) => {
      if (result === 'found') level.found++;
      else if (result === 'not-found') {
        level.notFound++;
        findings.push({
          rule: 'edge-not-found',
          severity: 'warning',
          ids: [id],
          message: `${who}${scene.line ? ` [${scene.line}]` : ''}: ${reason}`,
        });
      } else if (result === 'unsure') {
        level.unsure++;
        level.unsureEdges.push({ id, reason });
      } else level.notChecked++;
    };
    for (const e of props.edges) check(`edge "${edgeId(e)}"`, edgeId(e), edgeCall(e));
    const byId = new Map(props.edges.map((e) => [edgeId(e), e]));
    for (const step of props.steps ?? [])
      for (const beat of step.flow)
        for (const h of toBeat(beat).hops) {
          const e = byId.get(h.edge);
          if (!e || (h.source == null && h.via == null)) continue;
          const [a, b] = h.back ? [e.to, e.from] : [e.from, e.to];
          check(`hop on "${h.edge}"`, h.edge, call(h.source ?? (h.back ? undefined : e.source) ?? source.get(a), source.get(b), h.via));
        }
    for (const k of ['boxes', 'boxesDefined', 'found', 'notFound', 'unsure', 'notChecked'] as const) coverage[k] += level[k];
    coverage.unsureEdges.push(...level.unsureEdges);
    if (scene.line) levels.push({ path: scene.line, coverage: level });
  }
  if (levels.length) coverage.levels = levels;
  return { findings, coverage };
}

export const verify = (fig: FlowProps, opts: { root?: string } = {}): Finding[] => verifyReport(fig, opts).findings;
