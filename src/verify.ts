import { isAbsolute, relative, resolve, sep } from 'node:path';
import { edgeId, nodes, toBeat, type FlowProps } from './model.ts';
import { headingSlug, links } from './source.ts';
import type { Finding } from './scene.ts';
import { codeFile, isDefined, readFile, type CodeFile, type Read } from './code.ts';
import { edgeResult } from './edges.ts';

export { parseSource, headingSlug, owners, links, type Link } from './source.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
};

const emptyCoverage = (): Coverage => ({ boxes: 0, boxesDefined: 0, found: 0, notFound: 0, unsure: 0, notChecked: 0, unsureEdges: [] });

export const coverageLine = (figure: string, c: Coverage) =>
  `${figure}: ${c.boxesDefined} of ${c.boxes} boxes defined` +
  (c.found + c.notFound + c.unsure + c.notChecked
    ? `; edges: ${c.found} found, ${c.notFound} not found, ${c.unsure} unsure, ${c.notChecked} not checked`
    : '');

export const unsureLines = (c: Coverage) => c.unsureEdges.map((e) => `unsure   edge "${e.id}": ${e.reason}`);

/** The links against the files under `root`. A path outside `root` counts as a missing file. */
export function verifyReport(
  fig: FlowProps,
  { root = process.cwd(), read = readFile }: { root?: string; read?: Read } = {},
): { findings: Finding[]; coverage: Coverage } {
  const findings: Finding[] = [];
  const coverage = emptyCoverage();
  const all = links(fig);
  if (!all.length)
    return {
      findings: [{ rule: 'no-source', severity: 'warning', ids: [], message: 'no box, edge or hop has a source' }],
      coverage,
    };
  const files = new Map<string, string | null>();
  const parsed = new Map<string, CodeFile | null>();
  for (const l of all) {
    const full = resolve(root, l.path);
    const rel = relative(root, full);
    const outside = isAbsolute(l.path) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (!files.has(full)) files.set(full, outside ? null : read(full));
    const text = files.get(full);
    const before = findings.length;
    const fail = (rule: string, what: string) =>
      findings.push({ rule, severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: ${what}` });
    if (text == null) fail('missing-file', 'file not found');
    else if (l.symbol) {
      const code = codeFile(root, l.path, read, parsed);
      if (code) {
        if (!isDefined(code, l.symbol)) fail('missing-symbol', 'symbol not defined');
      } else if (
        !new RegExp(`(^|[^\\w$])${escape(l.symbol)}(?![\\w$])`).test(text) &&
        !(/\.(md|markdown)$/i.test(l.path) && hasHeading(text, l.symbol))
      )
        fail('missing-symbol', 'symbol not found');
    }
    if (l.owner.startsWith('box "')) {
      coverage.boxes++;
      if (findings.length === before) coverage.boxesDefined++;
    }
  }
  const source = new Map(nodes(fig.layout).map((n) => [n.id, n.source]));
  const check = (who: string, id: string, caller?: string, callee?: string, via?: string) => {
    const { result, reason } = caller ? edgeResult(root, caller, callee, via, read, parsed) : { result: 'not-checked', reason: '' };
    if (result === 'found') coverage.found++;
    else if (result === 'not-found') {
      coverage.notFound++;
      findings.push({ rule: 'edge-not-found', severity: 'warning', ids: [id], message: `${who}: ${reason}` });
    } else if (result === 'unsure') {
      coverage.unsure++;
      coverage.unsureEdges.push({ id, reason });
    } else coverage.notChecked++;
  };
  for (const e of fig.edges) check(`edge "${edgeId(e)}"`, edgeId(e), e.source ?? source.get(e.from), source.get(e.to), e.via);
  const byId = new Map(fig.edges.map((e) => [edgeId(e), e]));
  for (const step of fig.steps ?? [])
    for (const beat of step.flow)
      for (const h of toBeat(beat).hops) {
        const e = byId.get(h.edge);
        if (!e || (h.source == null && h.via == null)) continue;
        const [a, b] = h.back ? [e.to, e.from] : [e.from, e.to];
        check(`hop on "${h.edge}"`, h.edge, h.source ?? e.source ?? source.get(a), source.get(b), h.via);
      }
  return { findings, coverage };
}

export const verify = (fig: FlowProps, opts: { root?: string } = {}): Finding[] => verifyReport(fig, opts).findings;
