// `flowfig verify`: checks that the code a link names is still there. The link parsing lives in source.ts, which has no Node import.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { FlowProps } from './model.ts';
import { headingSlug, links } from './source.ts';
import type { Finding } from './scene.ts';

export { parseSource, headingSlug, owners, links, type Link } from './source.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The file text, or null for a missing path, a folder or an unreadable file. */
function read(full: string): string | null {
  try {
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
}

/** True if a heading line of the Markdown text has this slug. */
const hasHeading = (text: string, slug: string) =>
  text.split('\n').some((line) => {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    return m != null && headingSlug(m[1]) === slug;
  });

/** The links against the files under `root`. A path outside the root is a missing file: the figure names the repo, not the disk. */
export function verify(fig: FlowProps, { root = process.cwd() }: { root?: string } = {}): Finding[] {
  const out: Finding[] = [];
  const all = links(fig);
  if (!all.length) return [{ rule: 'no-source', severity: 'warning', ids: [], message: 'no box, edge or hop has a source' }];
  const files = new Map<string, string | null>();
  for (const l of all) {
    const full = resolve(root, l.path);
    const rel = relative(root, full);
    const outside = isAbsolute(l.path) || rel === '..' || rel.startsWith('../');
    if (!files.has(full)) files.set(full, outside ? null : read(full));
    const text = files.get(full);
    if (text == null) out.push({ rule: 'missing-file', severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: file not found` });
    else if (
      l.symbol &&
      !new RegExp(`(^|[^\\w$])${escape(l.symbol)}(?![\\w$])`).test(text) &&
      !(/\.(md|markdown)$/i.test(l.path) && hasHeading(text, l.symbol))
    )
      out.push({ rule: 'missing-symbol', severity: 'error', ids: [], message: `${l.owner} -> ${l.source}: symbol not found` });
  }
  return out;
}
