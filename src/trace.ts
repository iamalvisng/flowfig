import { posix } from 'node:path';
import { codeFile, definitions, depthAt, esc, langOf, locate, matchClose, pyBody, readFile, type CodeFile, type Read } from './code.ts';
import { EDGE_LANGS, edgeResult, paramName, params, shadows } from './edges.ts';
import { OUTSIDE, importsOf, reexports, type Import } from './imports.ts';
import { ancestors, declIn, defines, findType, isUpper, makeCtx, receiver, receiverChain, type Ctx, type Decl } from './types.ts';
import { goDirFiles } from './type-index.ts';
import { parseSource } from './source.ts';

export type TraceEdge = { from: string; to: string; at: string };
export type TraceNote = { at: string; reason: string };
export type TraceResult = {
  start: string;
  edges: TraceEdge[];
  unsure: TraceNote[];
  open: TraceNote[];
  stops: { reason: 'depth' | 'max'; count: number }[];
  outside: number;
  ms: number;
};
export type TraceOptions = { root?: string; depth?: number; max?: number; read?: Read };

type Target = { to: string } | { unsure: string } | 'outside' | null;

const CALL = /(?<![\w$])([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>\s*)?\(/g;
const REF = /[(,]\s*([A-Za-z_$][\w$]*)\s*(?=[,)])/g;
const ROUTE = /\(\s*(['"`])\/[^'"`]*\1\s*,\s*(['"`])([A-Za-z_$][\w$]*(?:(?:\.|@|::|#)[A-Za-z_$][\w$]*)+)\2/g;
const DEFAULT = /\bexport\s+default\s+(?:async\s+)?(?:function\s*\*?\s*|class\s+)?([A-Za-z_$][\w$]*)/;
const KEYWORDS = new Set(
  'if for while switch catch return typeof await function super sizeof using lock foreach elif assert yield throw not and or in with match when constructor'.split(
    ' ',
  ),
);

const innerParam = (body: string, n: string) => {
  const N = `(?<![\\w$.])${esc(n)}(?![\\w$])`;
  return new RegExp(
    `(?:\\([^()]*${N}[^()]*\\)|${N})\\s*(?::[^=)]+)?=>|\\bfunc(?:tion\\s*[\\w$]*)?\\s*\\((?:[^()]|\\([^()]*\\))*?${N}|\\blambda\\b[^:]*?${N}`,
  ).test(body);
};

const topLevel = (f: CodeFile, sym: string) => {
  const s = locate(f, sym);
  if (!s) return false;
  if (f.lang === 'go') return depthAt(f.code, s.start, 0) === 0 && !/^func\s*\(/.test(f.code.slice(s.start, s.end));
  return !/[ \t]/.test(f.code[f.code.lastIndexOf('\n', s.start - 1) + 1]);
};

const defined = (cx: Ctx, from: string, to: string) => {
  const [path, sym] = to.split('#');
  const f = codeFile(cx.root, path, cx.read, cx.cache)!;
  // A Java or C# constructor has the name of its type.
  if (f.lang === 'java' || f.lang === 'cs') return 1;
  return definitions(f, sym) + (path === from ? 0 : reexports(cx.root, f, sym, cx.read).length);
};

const CONTROL = /^(?:if|for|while|switch|catch|with|foreach|else|match|elif|except|try)\b/;

const enclosing = (f: CodeFile, pos: number): [number, number][] => {
  const { code } = f;
  const out: [number, number][] = [];
  if (f.lang === 'py') {
    let ind = /^[ \t]*/.exec(code.slice(code.lastIndexOf('\n', pos - 1) + 1))![0].length;
    for (let ls = code.lastIndexOf('\n', pos - 1); ls >= 0 && ind > 0; ls = code.lastIndexOf('\n', ls - 1)) {
      const line = code.slice(ls + 1, code.indexOf('\n', ls + 1) < 0 ? undefined : code.indexOf('\n', ls + 1));
      const w = /^[ \t]*/.exec(line)![0].length;
      if (!line.trim() || w >= ind) continue;
      ind = w;
      if (/^\s*(async\s+)?def\b/.test(line)) out.push(pyBody(code, ls + 1 + w));
    }
    return out;
  }
  if (f.lang === 'java' || f.lang === 'cs') return out;
  for (let i = pos, d = 0; i >= 0; i--) {
    if (code[i] === '}') d++;
    else if (code[i] === '{' && d-- === 0) {
      const head = code.slice(code.slice(0, i).search(/[;{}][^;{}]*$/) + 1, i).trim();
      if (!CONTROL.test(head) && /(?:\)\s*(?::[^;{}]*)?|=>)$/.test(head)) out.push([i, matchClose(code, i)]);
      d = 0;
    }
  }
  return out;
};

const lineOf = (code: string, pos: number) => code.slice(0, pos).split('\n').length;

function forward(cx: Ctx, path: string, name: string, depth = 0): Target {
  if (langOf(path) == null) {
    const f = goDirFiles(cx, path).find((g) => topLevel(g, name));
    return f ? { to: `${f.path}#${name}` } : null;
  }
  const f = codeFile(cx.root, path, cx.read, cx.cache);
  if (!f) return null;
  const named = name === 'default' ? DEFAULT.exec(f.code)?.[1] : undefined;
  if (named && locate(f, named)) return { to: `${path}#${named}` };
  if (locate(f, name)) return { to: `${path}#${name}` };
  if (depth >= 5) return null;
  let star = false;
  for (const [p, inner] of reexports(cx.root, f, name, cx.read)) {
    if (inner === '?') star = true;
    if (p == null || inner === '?') continue;
    const t = forward(cx, p, inner, depth + 1);
    if (t) return t;
  }
  return star ? { unsure: `star import: ${name}()` } : null;
}

function method(cx: Ctx, d: Decl, name: string): string | null {
  for (const x of [d, ...ancestors(cx, d).flatMap((a) => (a.d ? [a.d] : []))]) {
    const sym = `${x.name}.${name}`;
    const files = x.info.lang === 'go' ? goDirFiles(cx, posix.dirname(x.info.path)) : [x.info];
    const f = files.find((g) => locate(g, sym));
    if (f) return `${f.path}#${sym}`;
  }
  return null;
}

function resolve(
  cx: Ctx,
  fi: CodeFile,
  body: string,
  n: string,
  rc: { chain: string[]; complex: boolean } | null,
  container: string | null,
  decl: Decl | null,
  imps: Import[],
): Target {
  const gone = (p: string | null) => p == null || p === OUTSIDE;
  if (!rc) {
    const bind = imps.find((i) => i.local === n);
    if (bind) return gone(bind.path) ? 'outside' : bind.name === '*' ? null : forward(cx, bind.path!, bind.name);
    if (fi.lang === 'java' || fi.lang === 'cs') {
      const m = decl && method(cx, decl, n);
      if (m) {
        const own = [decl!, ...ancestors(cx, decl!).flatMap((a) => (a.d ? [a.d] : []))].filter((x) => defines(cx, x, n));
        return own.length > 1 ? { unsure: `${n} has two definitions` } : { to: m };
      }
    } else if (topLevel(fi, n)) return { to: `${fi.path}#${n}` };
    if (fi.lang === 'go') {
      const f = goDirFiles(cx, posix.dirname(fi.path)).find((g) => topLevel(g, n));
      if (f) return { to: `${f.path}#${n}` };
    }
    if ((fi.lang === 'java' || fi.lang === 'cs' || fi.lang === 'rs') && isUpper(n)) {
      const d = findType(cx, fi, n);
      if (d) return { to: `${d.info.path}#${d.name}` };
    }
    for (const i of imps.filter((x) => x.local === '*' || x.local === '.')) {
      if (i.path == null) return { unsure: `star import: ${n}()` };
      const t = i.path === OUTSIDE ? null : forward(cx, i.path, n);
      if (t) return t;
    }
    return null;
  }
  if (rc.complex) return null;
  const head = imps.find((i) => i.local === rc.chain[0]);
  if (head && gone(head.path)) return 'outside';
  const rt = receiver(cx, fi, body, rc.chain, container, decl);
  if (rt.name === '#external') return 'outside';
  if (rt.kind === 'module' && rt.mod) return forward(cx, rt.mod, n);
  if (rt.kind !== 'type' || rt.name === '#top') return null;
  const d = rt.decl ?? findType(cx, rt.ctx!, rt.name, rt.qual);
  const sym = d && method(cx, d, n);
  return sym ? { to: sym } : null;
}

function candidates(body: string, own: string): { name: string; idx: number; call: boolean }[] {
  const open = body.indexOf(own);
  const sig = open >= 0 && /^\s*(?:<[^<>]*>\s*)?\(/.test(body.slice(open + own.length)) ? body.indexOf('(', open) : -1;
  const from = sig < 0 ? 0 : matchClose(body, sig) + 1;
  const out: { name: string; idx: number; call: boolean }[] = [];
  for (const m of body.matchAll(CALL)) {
    const pre = body.slice(body.lastIndexOf('\n', m.index) + 1, m.index);
    if (m.index < from || KEYWORDS.has(m[1]) || /^\s*@/.test(pre) || /\b(?:def|func|fn|function)\s+$/.test(pre)) continue;
    out.push({ name: m[1], idx: m.index, call: true });
  }
  for (const m of body.matchAll(REF)) if (m.index >= from) out.push({ name: m[1], idx: m.index + m[0].indexOf(m[1], 1), call: false });
  return out.sort((a, b) => a.idx - b.idx);
}

function calls(cx: Ctx, caller: string, r: TraceResult): TraceEdge[] {
  const { path, symbol } = parseSource(caller)!;
  const fi = codeFile(cx.root, path, cx.read, cx.cache);
  const span = fi && locate(fi, symbol!);
  if (!fi || !span) return [];
  const body = fi.code.slice(span.start, span.end);
  const parts = symbol!.split('.');
  const own = parts.at(-1)!;
  const container = parts.length > 1 ? parts.at(-2)! : null;
  const decl = container ? (declIn(fi, container) ?? (fi.lang === 'go' ? findType(cx, fi, container) : null)) : null;
  const imps = importsOf(cx.root, fi, cx.read);
  const ps = new Set(params(body, own).map((p) => paramName(p, fi.lang)));
  const at = (i: number) => `${path}:${lineOf(fi.code, span.start + i)}`;
  for (const m of fi.keep.slice(span.start, span.end).matchAll(ROUTE)) r.open.push({ at: at(m.index), reason: `string route "${m[3]}"` });
  const outer = enclosing(fi, span.start);
  const targets = new Map<string, string>();
  for (const c of candidates(body, own)) {
    const rc = receiverChain(body, c.idx, fi.lang);
    if (c.call && !rc && ps.has(c.name)) {
      r.unsure.push({ at: at(c.idx), reason: `parameter call: ${c.name}()` });
      continue;
    }
    if (!rc && (shadows(body, c.name, fi.lang, own, false) || innerParam(body, c.name))) continue;
    const twice = { unsure: `${c.name} has two definitions` };
    const t =
      !rc &&
      [[span.start, span.end] as [number, number], ...outer].some(([a, b]) => definitions(fi, c.name, a, b) > (c.name === own ? 1 : 0))
        ? twice
        : resolve(cx, fi, body, c.name, rc, container, decl, imps);
    if (t === 'outside') r.outside += c.call ? 1 : 0;
    else if (t && 'unsure' in t) r.unsure.push({ at: at(c.idx), reason: t.unsure });
    else if (t && !rc && defined(cx, path, t.to) > 1) r.unsure.push({ at: at(c.idx), reason: twice.unsure });
    else if (t && t.to !== caller && !targets.has(t.to)) targets.set(t.to, at(c.idx));
  }
  const found: TraceEdge[] = [];
  for (const [to, where] of targets) {
    const { result, reason } = edgeResult(cx.root, caller, to, undefined, cx.read, cx.cache);
    if (result === 'found') found.push({ from: caller, to, at: where });
    else if (result === 'unsure') r.unsure.push({ at: where, reason });
    else if (result === 'not-checked') r.open.push({ at: where, reason });
  }
  return found;
}

export function trace(start: string, { root = process.cwd(), depth = 2, max = 40, read = readFile }: TraceOptions = {}): TraceResult {
  const t0 = performance.now();
  const src = parseSource(start);
  if (!src?.symbol) throw new Error(`${start}: expected file#symbol`);
  const lang = langOf(src.path);
  if (!lang || !EDGE_LANGS.has(lang)) throw new Error(`${src.path}: trace does not read this language`);
  const cache = new Map<string, CodeFile | null>();
  const fi = codeFile(root, src.path, read, cache);
  if (!fi) throw new Error(`${src.path}: file not found`);
  if (!locate(fi, src.symbol)) throw new Error(`${start}: symbol not defined`);
  const cx = makeCtx(root, read, cache);
  const r: TraceResult = { start, edges: [], unsure: [], open: [], stops: [], outside: 0, ms: 0 };
  const seen = new Set([start]);
  let level = [start];
  for (let d = 0; d < depth && level.length; d++) {
    const next: string[] = [];
    for (const [k, caller] of level.entries())
      for (const e of calls(cx, caller, r)) {
        r.edges.push(e);
        if (!seen.has(e.to)) next.push(e.to);
        seen.add(e.to);
        if (r.edges.length >= max) {
          r.stops.push({ reason: 'max', count: level.length - k - 1 + next.length });
          r.ms = Math.round(performance.now() - t0);
          return r;
        }
      }
    level = next;
  }
  if (level.length) r.stops.push({ reason: 'depth', count: level.length });
  r.ms = Math.round(performance.now() - t0);
  return r;
}

const count = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

export function traceLines(r: TraceResult, depth: number, max: number): string[] {
  const pairs = r.edges.map((e) => `${e.from} -> ${e.to}`);
  const width = Math.max(0, ...pairs.map((p) => p.length));
  const symbols = new Set([r.start, ...r.edges.map((e) => e.to)]).size;
  return [
    ...r.edges.map((e, i) => `${pairs[i].padEnd(width)}   ${e.at}`),
    ...r.unsure.map((u) => `unsure  ${u.at}  ${u.reason}`),
    ...r.open.map((o) => `open    ${o.at}  ${o.reason}`),
    ...r.stops.map((s) => `stop    ${s.reason} ${s.reason === 'depth' ? depth : max}: ${count(s.count, 'symbol')} not followed`),
    `summary: ${count(symbols, 'symbol')}, ${r.edges.length} found, ${r.unsure.length} unsure, ${r.open.length} open, ${count(r.outside, 'call')} outside the repo, ${(r.ms / 1000).toFixed(1)} s`,
  ];
}
