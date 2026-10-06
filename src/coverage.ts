import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { langOf, readFile, type CodeFile } from './code.ts';
import { loadSpec, specOf } from './load.ts';
import { detailFindings, links, SPEC_MARK, verifyReport } from './verify.ts';

export type FigureState = 'fail' | 'stale' | 'ok' | 'none';
export type FigureHealth = { figure: string; state: FigureState; detail: string };
export type CoverageReport = {
  figures: FigureHealth[];
  git: boolean;
  entries?: { glob: string; total: number; uncovered: string[] };
  folders?: { folder: string; covered: number; total: number }[];
};
export type CoverageOptions = { root?: string; figures?: string; entries?: string };

const globRe = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/^\.\//, '')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/|\*\*|\*|\?/g, (t) => (t === '**/' ? '(?:.*/)?' : t === '**' ? '.*' : t === '*' ? '[^/]*' : '[^/]'))}$`,
  );

const isTest = (p: string) =>
  /(^|\/)(__tests__|tests|src\/test)\//.test(p) || /\.(test|spec)\.[^/]+$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|Tests?\.(java|cs)$/.test(p);

const day = (t: number) => (t === Infinity ? 'now' : new Date(t * 1000).toISOString().slice(0, 10));

const count = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

function gitTimes(root: string): ((path: string) => number) | null {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const prefix = git('rev-parse', '--show-prefix').trim();
    const dirty = new Set(
      git('status', '--porcelain', '-z', '--no-renames', '--untracked-files=all')
        .split('\0')
        .map((l) => l.slice(3))
        .filter((p) => p && p.startsWith(prefix))
        .map((p) => p.slice(prefix.length)),
    );
    const memo = new Map<string, number>();
    return (path) => {
      if (dirty.has(path)) return Infinity;
      if (!memo.has(path)) memo.set(path, Number(git('log', '-1', '--format=%ct', '--', path).trim()) || 0);
      return memo.get(path)!;
    };
  } catch {
    return null;
  }
}

export function coverageReport({ root = process.cwd(), figures = '**/*.svg', entries }: CoverageOptions = {}): CoverageReport {
  const all = readFile.files!(root).filter((p) => !p.split('/').includes('dist'));
  const want = globRe(figures);
  const time = gitTimes(root);
  const cache = new Map<string, CodeFile | null>();
  const covered = new Set<string>();
  const out: FigureHealth[] = [];
  for (const figure of all.filter((p) => p.endsWith('.svg') && want.test(p))) {
    const text = readFileSync(resolve(root, figure), 'utf8');
    if (!text.includes(SPEC_MARK)) continue;
    let fig;
    try {
      fig = loadSpec(JSON.parse(specOf(text, figure)), figure);
    } catch (e) {
      out.push({ figure, state: 'fail', detail: `bad spec: ${(e as Error).message}` });
      continue;
    }
    const paths = [...new Set(links(fig).map((l) => posix.normalize(l.path)))];
    paths.forEach((p) => covered.add(p));
    const lost = detailFindings(fig, root).length;
    const lostText = lost ? `; ${lost} missing-detail` : '';
    if (!paths.length) {
      out.push({ figure, state: 'none', detail: `no source links${lostText}` });
      continue;
    }
    const { findings, coverage } = verifyReport(fig, { root, cache });
    const errors = findings.filter((f) => f.severity === 'error');
    if (errors.length) {
      out.push({
        figure,
        state: 'fail',
        detail: `${count(errors.length, 'error')}: ${[...new Set(errors.map((f) => f.rule))].join(', ')}`,
      });
      continue;
    }
    const mine = time?.(figure) || Infinity;
    const newer = time && paths.find((p) => time(p) > mine);
    out.push(
      newer
        ? { figure, state: 'stale', detail: `${newer} changed ${day(time!(newer))}, figure ${day(mine)}` }
        : { figure, state: 'ok', detail: `${coverage.boxesDefined} of ${coverage.boxes} boxes defined${lostText}` },
    );
  }
  const code = all.filter((p) => langOf(p) != null && !isTest(p));
  const report: CoverageReport = { figures: out, git: time != null };
  if (entries) {
    const re = globRe(entries);
    const named = entries.replace(/^\.\//, '');
    const matched = all.filter((p) => langOf(p) != null && re.test(p) && (p === named || !isTest(p)));
    report.entries = { glob: entries, total: matched.length, uncovered: matched.filter((p) => !covered.has(p)) };
  } else {
    const by = new Map<string, { folder: string; covered: number; total: number }>();
    for (const p of code) {
      const folder = p.includes('/') ? p.slice(0, p.indexOf('/')) : '.';
      const row = by.get(folder) ?? { folder, covered: 0, total: 0 };
      row.total++;
      if (covered.has(p)) row.covered++;
      by.set(folder, row);
    }
    report.folders = [...by.values()];
  }
  return report;
}

export function coverageLines(r: CoverageReport): string[] {
  const width = Math.max(0, ...r.figures.map((f) => f.figure.length));
  const tally = (s: FigureState) => r.figures.filter((f) => f.state === s).length;
  return [
    ...(r.git ? [] : ['no git: stale is not checked']),
    ...r.figures.map((f) => `${f.figure.padEnd(width + 4)}${f.state.padEnd(8)}${f.detail}`),
    ...(r.entries
      ? [
          `uncovered ${r.entries.glob}: ${r.entries.uncovered.length} of ${r.entries.total} files have no figure`,
          ...r.entries.uncovered.map((p) => `  ${p}`),
        ]
      : []),
    ...(r.folders ?? []).map((f) => `code ${f.folder}: ${f.covered} of ${f.total} files have a figure`),
    `summary: ${count(r.figures.length, 'figure')}: ${tally('ok')} ok, ${tally('stale')} stale, ${tally('fail')} fail, ${tally('none')} none`,
  ];
}
