import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { coverageLines, coverageReport, type FigureHealth } from './coverage.ts';
import { loadSpec, specOf } from './load.ts';
import { altText, nodes, str, type FlowProps } from './model.ts';
import { openFile } from './open.ts';
import { esc, pageHtml } from './page.ts';
import { toSvg } from './svg.ts';

export type AtlasOptions = { root?: string; figures?: string };

const USAGE = 'usage: flowfig atlas [--figures <glob>] [--root <dir>] [--out <dir>] [--open]';

const CSS = `body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 16px }
table { border-collapse: collapse; width: 100% }
td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, CanvasText 20%, transparent) }
strong[data-state] { padding: 1px 8px; border-radius: 4px; border: 1px solid currentColor; font-size: 14px }
strong[data-state="ok"] { color: light-dark(#116329, #7ee787) }
strong[data-state="stale"] { color: light-dark(#8a5a00, #e3b341) }
strong[data-state="fail"] { color: light-dark(#b42318, #ff7b72) }
strong[data-state="none"] { color: GrayText }`;

const badge = (f: FigureHealth) => `<strong data-state="${f.state}">${f.state}</strong>`;

const pageOf = (figure: string) => {
  const page = figure.replace(/\.svg$/, '.html');
  return page === 'index.html' ? 'index.figure.html' : page;
};

const hrefTo = (from: string, to: string) => posix.relative(posix.dirname(from), to);

export function atlasFiles({ root = process.cwd(), figures }: AtlasOptions = {}): Map<string, string> {
  const report = coverageReport({ root, figures });
  const rows = report.figures.sort((a, b) => a.figure.localeCompare(b.figure));
  if (!rows.length) return new Map();
  const specs = new Map<string, FlowProps>();
  for (const { figure } of rows) {
    try {
      specs.set(figure, loadSpec(JSON.parse(specOf(readFileSync(resolve(root, figure), 'utf8'), figure)), figure));
    } catch {}
  }
  const files = new Map<string, string>();
  const shell = (title: string, body: string) =>
    `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n:root { color-scheme: light dark }\n${CSS}\n</style>\n${body}\n`;
  for (const f of rows) {
    const spec = specs.get(f.figure);
    if (!spec) continue;
    const page = pageOf(f.figure);
    const targets = nodes(spec.layout).flatMap((n) => {
      const to = typeof n.detail === 'string' ? posix.normalize(n.detail) : '';
      return to && specs.has(to) ? [{ n, to }] : [];
    });
    const hrefs = new Map(targets.map(({ n, to }) => [n.id, hrefTo(page, pageOf(to))]));
    const svg = toSvg(spec, { links: Object.fromEntries(hrefs) });
    const details = nodes(spec.layout)
      .filter((n) => typeof n.detail === 'string')
      .map((n) => {
        const name = esc(str(n.label) || n.id);
        const href = hrefs.get(n.id);
        return `<li>${name}: ${href == null ? `${esc(n.detail!)} (not in the atlas)` : `<a href="${esc(href)}">${esc(n.detail!)}</a>`}</li>`;
      });
    const { title, desc } = altText(spec);
    const before =
      `<style>\n${CSS}\n</style>\n<main>\n<p><a href="${esc(hrefTo(page, 'index.html'))}">All figures</a></p>\n` +
      `<h1>${esc(f.figure)}</h1>\n<p>${badge(f)} ${esc(f.detail)}</p>\n`;
    const after =
      (details.length ? `\n<h2>Details</h2>\n<ul>\n${details.join('\n')}\n</ul>` : '') +
      `\n<details><summary>Transcript</summary><pre style="white-space: pre-wrap">${esc(desc)}</pre></details>\n</main>`;
    files.set(page, pageHtml(svg, `${title} (${f.figure})`, before, after));
  }
  const body = rows
    .map((f) => {
      const spec = specs.get(f.figure);
      const name = spec ? `<a href="${esc(pageOf(f.figure))}">${esc(f.figure)}</a>` : esc(f.figure);
      return `<tr><td>${name}</td><td>${badge(f)}</td><td>${esc(f.detail)}</td><td>${spec ? esc(altText(spec).title) : ''}</td></tr>`;
    })
    .join('\n');
  files.set(
    'index.html',
    shell(
      'Figures',
      `<main>\n<h1>Figures</h1>\n<p>${esc(coverageLines(report).at(-1)!)}</p>\n<table>\n<tr><th>Figure</th><th>Health</th><th>Detail</th><th>Title</th></tr>\n${body}\n</table>\n</main>`,
    ),
  );
  files.set('.nojekyll', '');
  return files;
}

export async function runAtlas(argv: string[]): Promise<number> {
  const fail = (message: string, code: number) => (console.error(message), code);
  const args = [...argv];
  const open = args.includes('--open');
  if (open) args.splice(args.indexOf('--open'), 1);
  const opts: Record<string, string> = {};
  for (const name of ['--figures', '--root', '--out']) {
    const at = args.indexOf(name);
    if (at === -1) continue;
    const value = args.splice(at, 2)[1];
    if (!value || value.startsWith('-')) return fail(`${name} needs a value`, 2);
    opts[name] = value;
  }
  if (args.length) return fail(args[0].startsWith('-') ? `unknown flag ${args[0]}` : USAGE, 2);
  const root = resolve(opts['--root'] ?? '.');
  if (!existsSync(root)) return fail(`${root}: the folder does not exist`, 2);
  const files = atlasFiles({ root, figures: opts['--figures'] });
  if (!files.size) return fail('no figure SVG matches', 1);
  const out = resolve(opts['--out'] ?? 'atlas');
  for (const [path, text] of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  const index = join(out, 'index.html');
  console.log(`${index} — ${files.size - 2} figure pages`);
  if (open) {
    try {
      await openFile(index);
    } catch (e) {
      return fail(`open: ${(e as Error).message}`, 1);
    }
  }
  return 0;
}
