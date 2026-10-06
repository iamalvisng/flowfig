import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { readFile, type CodeFile } from './code.ts';
import { loadSpec, specOf } from './load.ts';
import { links, verifyReport } from './verify.ts';

export type FigureState = 'fail' | 'stale' | 'ok' | 'none';
export type FigureHealth = { figure: string; state: FigureState; detail: string };
export type CoverageReport = { figures: FigureHealth[]; git: boolean };
export type CoverageOptions = { root?: string; figures?: string };

const MARK = '<metadata id="figure-spec">';

const globRe = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/^\.\//, '')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/|\*\*|\*|\?/g, (t) => (t === '**/' ? '(?:.*/)?' : t === '**' ? '.*' : t === '*' ? '[^/]*' : '[^/]'))}$`,
  );

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
      if (!memo.has(path)) memo.set(path, Number(git('log', '-1', '--format=%ct', '--', path).trim()) || Infinity);
      return memo.get(path)!;
    };
  } catch {
    return null;
  }
}

export function coverageReport({ root = process.cwd(), figures = '**/*.svg' }: CoverageOptions = {}): CoverageReport {
  const all = readFile.files!(root).filter((p) => !p.split('/').includes('dist'));
  const want = globRe(figures);
  const time = gitTimes(root);
  const cache = new Map<string, CodeFile | null>();
  const out: FigureHealth[] = [];
  for (const figure of all.filter((p) => p.endsWith('.svg') && want.test(p))) {
    const text = readFileSync(resolve(root, figure), 'utf8');
    if (!text.includes(MARK)) continue;
    let fig;
    try {
      fig = loadSpec(JSON.parse(specOf(text, figure)), figure);
    } catch (e) {
      out.push({ figure, state: 'fail', detail: `bad spec: ${(e as Error).message}` });
      continue;
    }
    const paths = [...new Set(links(fig).map((l) => posix.normalize(l.path)))];
    if (!paths.length) {
      out.push({ figure, state: 'none', detail: 'no source links' });
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
    const mine = time?.(figure) ?? Infinity;
    const newer = time && paths.find((p) => time(p) > mine);
    out.push(
      newer
        ? { figure, state: 'stale', detail: `${newer} changed ${day(time!(newer))}, figure ${day(mine)}` }
        : { figure, state: 'ok', detail: `${coverage.boxesDefined} of ${coverage.boxes} boxes defined` },
    );
  }
  return { figures: out, git: time != null };
}
