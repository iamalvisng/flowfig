import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FlowProps } from './model.ts';
import { headingSlug, links } from './source.ts';
import type { Finding } from './scene.ts';
import { codeFile, isDefined, readFile, type CodeFile, type Read } from './code.ts';

export { parseSource, headingSlug, owners, links, type Link } from './source.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasHeading = (text: string, slug: string) =>
  text.split('\n').some((line) => {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    return m != null && headingSlug(m[1]) === slug;
  });

export type Coverage = { boxes: number; boxesDefined: number };

export const coverageLine = (figure: string, c: Coverage) => `${figure}: ${c.boxesDefined} of ${c.boxes} boxes defined`;

/** The links against the files under `root`. A path outside `root` counts as a missing file. */
export function verifyReport(
  fig: FlowProps,
  { root = process.cwd(), read = readFile }: { root?: string; read?: Read } = {},
): { findings: Finding[]; coverage: Coverage } {
  const findings: Finding[] = [];
  const coverage: Coverage = { boxes: 0, boxesDefined: 0 };
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
  return { findings, coverage };
}

export const verify = (fig: FlowProps, opts: { root?: string } = {}): Finding[] => verifyReport(fig, opts).findings;
