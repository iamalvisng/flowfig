import { dirname, resolve } from 'node:path';
import { codeFile, esc, langOf, locate, matchClose, readFile, type CodeFile, type Lang, type Read } from './code.ts';
import { importsOf, leadsTo } from './imports.ts';
import { parseSource } from './source.ts';

export type EdgeResult = 'found' | 'not-found' | 'unsure' | 'not-checked';

export const EDGE_LANGS: ReadonlySet<Lang> = new Set(['ts', 'py', 'go', 'java', 'cs', 'rs']);

type Src = { path: string; symbol?: string };

const ID = (lang: Lang) => (lang === 'ts' ? '[A-Za-z_$][\\w$]*' : '[A-Za-z_]\\w*');
const word = (name: string) => new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`);
const IMPORT_LINES =
  /\b(?:import|export)\s+(?:type\s+)?[\w*\s,{}$]*?\bfrom\b|^[ \t]*(?:from|use|using|package|import)\b.*|.*\brequire\(.*/gm;
const MODIFIERS = new Set([
  'mut',
  'final',
  'const',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
  'ref',
  'out',
  'in',
  'this',
  'params',
]);

function params(body: string, from: string | undefined): string[] {
  const open = body.indexOf('(', from ? Math.max(0, body.indexOf(from)) : 0);
  if (open < 0) return [];
  const text = body.slice(open + 1, matchClose(body, open));
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if ('<([{'.includes(text[i])) depth++;
    else if ('>)]}'.includes(text[i]) && text[i - 1] !== '=') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }
  return [...parts, text.slice(last)];
}

function shadows(body: string, name: string, lang: Lang, fromName: string | undefined, whole: boolean): boolean {
  const n = esc(name);
  if (!whole)
    for (const p of params(body, fromName)) {
      const tokens = (p.split('=')[0].match(/[\w$]+/g) ?? []).filter((t) => !MODIFIERS.has(t));
      if ((lang === 'java' || lang === 'cs' ? tokens.at(-1) : tokens[0]) === name) return true;
    }
  return [
    `\\b(let|const|var|val|mut)\\s+${n}(?![\\w$])`,
    `(?<![\\w$.])${n}\\s*:=`,
    `(^|[\\n;{])[ \\t]*${n}\\s*(:[^=\\n]+)?=(?![=>])`,
    `(?<![\\w$.])(?!(return|else|throw|new|await|yield|case|do|in|is|as)\\b)[\\w<>\\[\\],.?]+\\s+${n}\\s*(=(?![=>])|;)`,
  ].some((p) => new RegExp(p).test(body));
}

const defaultIs = (ti: CodeFile, symbol: string) =>
  new RegExp(`export\\s+default\\s+(async\\s+)?(function\\s*\\*?\\s*|class\\s+)?${esc(symbol.split('.')[0])}\\b`).test(ti.code);

const label = (s: Src) => s.symbol ?? s.path;

function viaResult(root: string, from: Src, to: Src | undefined, via: string, read: Read, cache: Map<string, CodeFile | null>) {
  const body = (s: Src) => {
    const file = codeFile(root, s.path, read, cache);
    if (!file) return read(resolve(root, s.path));
    const at = s.symbol ? locate(file, s.symbol) : { start: 0, end: file.keep.length };
    return at && file.keep.slice(at.start, at.end);
  };
  const token = word(via);
  const a = body(from);
  if (a == null) return { result: 'not-checked' as const, reason: `${label(from)} is not in the code` };
  if (!token.test(a)) return { result: 'not-found' as const, reason: `"${via}" is not in ${label(from)}` };
  if (!to) return { result: 'found' as const, reason: `"${via}" is in ${label(from)}` };
  const b = body(to);
  if (b == null) return { result: 'not-checked' as const, reason: `${label(to)} is not in the code` };
  if (!token.test(b)) return { result: 'not-found' as const, reason: `"${via}" is not in ${label(to)}` };
  return { result: 'found' as const, reason: `"${via}" is in ${label(from)} and in ${label(to)}` };
}

function fileResult(
  root: string,
  fi: CodeFile,
  ti: CodeFile,
  body: string,
  whole: boolean,
  from: Src,
  to: Src,
  read: Read,
  cache: Map<string, CodeFile | null>,
) {
  const names = importsOf(root, fi, read)
    .filter((i) => i.path != null && leadsTo(root, i.path, to.path, read, cache))
    .map((i) => i.local);
  if (fi.lang === 'go' && dirname(from.path) === dirname(to.path) && from.path !== to.path)
    for (const m of ti.code.matchAll(/^(?:func|type|var|const)\s+([\p{L}_][\p{L}\p{N}_]*)/gmu)) names.push(m[1]);
  const fromName = from.symbol?.split('.').at(-1);
  const hit = names.find((n) => word(n).test(body) && !shadows(body, n, fi.lang, fromName, whole));
  const who = label(from);
  return hit
    ? { result: 'found' as const, reason: `${who} uses ${hit} from ${to.path}` }
    : { result: 'not-found' as const, reason: `${who} does not use ${to.path}` };
}

export function edgeResult(
  root: string,
  caller: string,
  callee: string | undefined,
  via: string | undefined,
  read: Read = readFile,
  cache = new Map<string, CodeFile | null>(),
): { result: EdgeResult; reason: string } {
  const skip = (reason: string) => ({ result: 'not-checked' as const, reason });
  const from = parseSource(caller);
  const to = callee == null ? undefined : (parseSource(callee) ?? undefined);
  if (!from) return skip('the caller has no source');
  if (callee === caller) return skip('both boxes have the same source');
  if (via) return viaResult(root, from, to, via, read, cache);
  if (!to) return skip('the callee has no source');
  const supported = (p: Src) => {
    const lang = langOf(p.path);
    return lang != null && EDGE_LANGS.has(lang);
  };
  if (!supported(from) || !supported(to)) return skip('the language is not checked');
  const fi = codeFile(root, from.path, read, cache);
  const ti = codeFile(root, to.path, read, cache);
  if (!fi || !ti) return skip('a file is missing');
  const at = from.symbol ? locate(fi, from.symbol) : { start: 0, end: fi.code.length };
  if (!at) return skip(`${from.symbol} is not defined`);
  if (to.symbol && !locate(ti, to.symbol)) return skip(`${to.symbol} is not defined`);

  const whole = !from.symbol;
  let body = fi.code.slice(at.start, at.end);
  if (whole) body = body.replace(IMPORT_LINES, (m) => m.replace(/[^\n]/g, ' '));
  if (!to.symbol) return fileResult(root, fi, ti, body, whole, from, to, read, cache);
  const toName = to.symbol.split('.').at(-1)!;
  const toContainer = to.symbol.includes('.') ? to.symbol.split('.')[0] : null;
  const fromName = from.symbol?.split('.').at(-1);
  const imps = importsOf(root, fi, read);
  const byLocal = new Map(imps.map((i) => [i.local, i]));
  const leads = (path: string | null) => path != null && leadsTo(root, path, to.path, read, cache);
  const names = new Set([toName]);
  for (const i of imps) if (i.name === toName || (i.name === 'default' && leads(i.path) && defaultIs(ti, to.symbol))) names.add(i.local);

  const hits: { n: string; qual: string | null; member: boolean }[] = [];
  for (const n of names) {
    if (shadows(body, n, fi.lang, fromName, whole)) continue;
    const re = new RegExp(word(n).source, 'g');
    let m;
    while ((m = re.exec(body))) {
      const before = body.slice(0, m.index);
      const member = /\.\s*$/.test(before);
      if (fromName === n && m.index < 200 && before.trim().length < 60 && !member) continue;
      const qual = new RegExp(`(${ID(fi.lang)})\\s*(\\?)?\\.\\s*$`).exec(body.slice(Math.max(0, m.index - 80), m.index));
      hits.push({ n, qual: qual?.[1] ?? null, member });
    }
  }

  const who = label(from);
  const found = (how: string) => ({ result: 'found' as const, reason: `${who} calls ${toName} ${how}` });
  const same = from.path === to.path || (fi.lang === 'go' && dirname(from.path) === dirname(to.path));
  const fileLeads = () => imps.some((i) => leads(i.path));
  for (const h of hits) {
    const bind = byLocal.get(h.member ? (h.qual ?? '') : h.n);
    if (!h.member) {
      if (bind) {
        if (leads(bind.path)) return found('through an import');
      } else if (h.n === toName && same) return found('in the same file');
      continue;
    }
    if (bind) {
      if (leads(bind.path)) return found('through a qualified import');
      if (toContainer && h.qual === toContainer) return found('through its class import');
      continue;
    }
    if (toContainer && h.qual === toContainer && (same || byLocal.has(toContainer))) return found('as a static member');
    if (same || fileLeads() || (toContainer && word(toContainer).test(fi.code))) return found('as a member name');
  }
  return { result: 'not-found', reason: `${who} does not call ${toName}` };
}
