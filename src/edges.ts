import { dirname, resolve } from 'node:path';
import { codeFile, esc, langOf, locate, matchClose, readFile, type CodeFile, type Lang, type Read } from './code.ts';
import { importsOf, leadsTo } from './imports.ts';
import {
  ancestors,
  declIn,
  findType,
  inTypePosition,
  isUpper,
  localType,
  makeCtx,
  normType,
  receiver,
  receiverChain,
  reaches,
  rustMod,
  rustUses,
  type Reach,
} from './types.ts';
import { parseSource } from './source.ts';

export type EdgeResult = 'found' | 'not-found' | 'unsure' | 'not-checked';

export const EDGE_LANGS: ReadonlySet<Lang> = new Set(['ts', 'py', 'go', 'java', 'cs', 'rs']);

type Src = { path: string; symbol?: string };

type Verdict = { res: 'found' | 'not' | 'unsure' | 'skip'; why: string };
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
  const toParts = to.symbol.split('.');
  const toName = toParts.at(-1)!;
  const owner = toParts.length > 1 ? toParts.at(-2)! : null;
  const fromParts = from.symbol?.split('.') ?? [];
  const fromName = fromParts.at(-1);
  const fromContainer = fromParts.length > 1 ? fromParts.at(-2)! : null;
  const cx = makeCtx(root, read, cache);
  const lang = fi.lang;
  const fromDecl = fromContainer ? (declIn(fi, fromContainer) ?? (lang === 'go' ? findType(cx, fi, fromContainer) : null)) : null;
  const ownerDecl = owner ? (declIn(ti, owner) ?? (ti.lang === 'go' ? findType(cx, ti, owner) : null)) : null;
  const tb = locate(ti, to.symbol)!;
  const extType =
    ti.lang === 'cs' ? normType(/^[^{;]*?\(\s*this\s+([\w.<>?]+)/.exec(ti.code.slice(tb.start, tb.end))?.[1], 'cs')?.name : null;
  const imps = importsOf(root, fi, read);
  const byLocal = new Map(imps.map((i) => [i.local, i]));
  const leads = (path: string | null) => path != null && leadsTo(root, path, to.path, read, cache);
  const names = new Set([toName]);
  for (const i of imps) if (i.name === toName || (i.name === 'default' && leads(i.path) && defaultIs(ti, to.symbol))) names.add(i.local);
  const same = from.path === to.path || ((lang === 'go' || lang === 'java') && dirname(from.path) === dirname(to.path));
  const who = label(from);
  const found = (how: string): Verdict => ({ res: 'found', why: `${who} calls ${toName} ${how}` });
  const not = (why: string): Verdict => ({ res: 'not', why });
  const unsure = (why: string): Verdict => ({ res: 'unsure', why });
  const ignore: Verdict = { res: 'skip', why: '' };
  const byReach = (r: Reach, how: string) =>
    r === 'yes' ? found(how) : r === 'no' ? not(`${who} does not call ${toName}`) : unsure(`the type of the receiver is not read`);

  const judge = (n: string, idx: number, shadowed: boolean): Verdict => {
    const rc = receiverChain(body, idx, lang);
    if (!rc) {
      if (inTypePosition(body, idx, lang)) return ignore;
      if (owner && n === owner && /\bnew\s+$/.test(body.slice(Math.max(0, idx - 10), idx)))
        return findType(cx, fi, n)?.info.path === to.path ? found('with new') : not(`${who} creates another ${n}`);
      if ((lang === 'java' || lang === 'cs') && owner && /^\s*[(<]/.test(body.slice(idx + n.length))) {
        if (!fromContainer) return unsure(`the class of ${who} is not known`);
        return byReach(reaches(cx, { kind: 'type', name: fromContainer, ctx: fi }, ownerDecl, owner, toName, to.path), 'on this');
      }
      if (lang === 'java' && owner && n !== owner) return ignore;
      if ((lang === 'java' || lang === 'cs' || lang === 'rs') && !owner && isUpper(n)) {
        const d = findType(cx, fi, n);
        if (d) return d.info.path === to.path ? found('as a type') : ignore;
      }
      if (owner && (lang === 'ts' || lang === 'py' || lang === 'go' || lang === 'rs')) {
        if (lang === 'ts' && new RegExp(`\\{[^}]*\\b${esc(n)}\\b[^}]*\\}\\s*=\\s*this\\b`).test(body)) return found('through this');
        return lang === 'rs' && same && n === toName ? found('in the same file') : ignore;
      }
      if ((shadowed || (n === toName && localType(cx, fi, body, n, lang))) && n !== fromName) return ignore;
      if (n !== toName) return found('through an alias');
      const bind = byLocal.get(n);
      if (bind && leads(bind.path)) return found('through an import');
      if (!bind && same) return found('in the same file');
      if (lang === 'rs' && rustUses(fi, n, to.path)) return found('through a use item');
      return (lang === 'java' || lang === 'cs') && !owner ? unsure(`the import of ${n} is not read`) : ignore;
    }
    if (rc.complex) return unsure(rc.chain.length ? 'the receiver chain has a call' : 'the receiver is an expression');
    const chain = rc.chain;
    if (owner && chain.length === 1 && chain[0] === owner) return found('through its class');
    const rt = receiver(cx, fi, body, chain, fromContainer, fromDecl);
    if (rt.kind === 'rsmod') {
      if (owner && ownerDecl) return not(`${who} uses a module path for a method`);
      return chain.at(-1) === rustMod(to.path) || (chain.length === 1 && rustUses(fi, chain[0], to.path))
        ? found('through a module path')
        : not(`${who} uses another module`);
    }
    if (rt.kind === 'module') {
      if (!rt.mod) return not(`${who} uses a module outside the repo`);
      if (owner && ownerDecl) return not(`${who} uses a module member for a method`);
      return leads(rt.mod) ? found('through a module') : not(`${who} uses another module`);
    }
    if (rt.kind === 'value') {
      if (owner) return unsure(`the type of ${chain.join('.')} is not read`);
      return leads(rt.mod ?? null) ? found('through an imported value') : not(`${who} uses another value`);
    }
    if (rt.kind === 'super')
      return fromDecl && ancestors(cx, fromDecl).some((x) => x.name === owner)
        ? found('through super')
        : not(`${who} calls super of another class`);
    if (rt.kind !== 'type') return unsure(`the type of ${chain.join('.')} is not known`);
    if (!owner) return not(`${who} calls a free function on a typed receiver`);
    if (extType) {
      if (rt.name === extType) return found('as an extension');
      const rd = findType(cx, rt.ctx!, rt.name, rt.qual);
      if (rd && ancestors(cx, rd).some((x) => x.name === extType)) return found('as an extension');
      return rd || rt.name === '#external'
        ? not(`${who} calls an extension of another type`)
        : unsure(`the type of ${chain.join('.')} is not read`);
    }
    return byReach(reaches(cx, rt, ownerDecl, owner, toName, to.path), `on ${rt.name}`);
  };

  const verdicts: Verdict[] = [];
  let skippedDef = false;
  for (const n of names) {
    const shadowed = shadows(body, n, lang, fromName, whole);
    const re = new RegExp(word(n).source, 'g');
    let m;
    while ((m = re.exec(body))) {
      const before = body.slice(0, m.index);
      if (!skippedDef && fromName === n && m.index < 200 && before.trim().length < 60 && !/(\.|::)\s*$/.test(before)) {
        skippedDef = true;
        continue;
      }
      verdicts.push(judge(n, m.index, shadowed));
    }
  }
  const pick = verdicts.find((v) => v.res === 'found') ?? verdicts.find((v) => v.res === 'unsure');
  if (pick) return { result: pick.res === 'found' ? 'found' : 'unsure', reason: pick.why };
  return { result: 'not-found', reason: `${who} does not call ${toName}` };
}
