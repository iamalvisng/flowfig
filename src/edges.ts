import { dirname } from 'node:path';
import { codeFile, esc, langOf, locate, matchClose, outside, readFile, type CodeFile, type Lang, type Read } from './code.ts';
import { importsOf, leadsTo, type Import } from './imports.ts';
import {
  ancestors,
  declIn,
  defines,
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
const viaToken = (t: string) => new RegExp(`${/^[\w$]/.test(t) ? '(?<![\\w$])' : ''}${esc(t)}${/[\w$]$/.test(t) ? '(?![\\w$])' : ''}`, 'g');
function viaHits(via: string, keep: string, code: string | null): { at: number; near: boolean }[] {
  const tail = /[\w$]$/.test(via);
  return [...keep.matchAll(viaToken(via))].map((m) => ({
    at: m.index,
    near: tail && (code == null || code[m.index] !== keep[m.index]) && /^[./-]/.test(keep.slice(m.index + m[0].length)),
  }));
}
const IMPORT_LINE: Record<Lang, RegExp> = {
  ts: /^\s*(?:(?:import|export)\b[^'"]*\bfrom\s*|import\s*|\}\s*from\s*|(?:const|let|var)\s+[^=]+=\s*require\(\s*)['"][^'"]*['"]\s*\)?\s*;?\s*$/,
  py: /^\s*(?:import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*|from\s+[\w.]+\s+import\s+[^=()]+)\s*$/,
  go: /^\s*(?:import\s*(?:\w+\s+)?"[^"]*"|(?:[\w.]+\s+)?"[^"]*")\s*$/,
  java: /^\s*import\s+(?:static\s+)?[\w.*]+\s*;\s*$/,
  cs: /^\s*(?:global\s+)?using\s+(?:static\s+)?[\w.]+\s*;\s*$/,
  rs: /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+[^;]*;\s*$/,
};
const LOG_CALL = /\b(?:log|logger|console|logging)\s*\.\s*\w+\s*\(|(?<![\w.])(?:print|println|printf)!?\s*\(/;
const FUNCS: Record<Lang, RegExp> = {
  ts: /\bfunction\b|=>|^[ \t]*(?:(?:public|private|protected|static|async|get|set|override)\s+)*(?!(?:if|for|while|switch|catch)\b)[\w$]+\s*\([^()]*\)\s*(?::[^{;]*)?\{/gm,
  py: /\bdef\s|\blambda\b/g,
  go: /\bfunc\b/g,
  rs: /\bfn\s/g,
  java: /->|^[ \t]*(?:[\w<>[\],.?]+[ \t]+)+(?!(?:if|for|while|switch|catch|new|return)\b)\w+\s*\([^;{]*\)\s*(?:throws[^{;]*)?\{/gm,
  cs: /=>|^[ \t]*(?:[\w<>[\],.?]+[ \t]+)+(?!(?:if|for|while|switch|catch|new|return|using|lock)\b)\w+\s*\([^;{]*\)\s*\{/gm,
};
const CONSTS: Record<Lang, RegExp> = {
  ts: /^(?:export\s+)?const\s+([\w$]+)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`\n]*)\2/gm,
  py: /^([A-Za-z_]\w*)\s*(?::\s*str\s*)?=\s*(['"])([^'"\n]*)\2/gm,
  go: /^const\s+(\w+)\s*(?:string\s*)?=\s*(["`])([^"`\n]*)\2/gm,
  java: /^[ \t]*(?:(?:public|private|protected)\s+)?static\s+final\s+String\s+(\w+)\s*=\s*(")([^"\n]*)"/gm,
  cs: /^[ \t]*(?:(?:public|private|protected|internal)\s+)?const\s+string\s+(\w+)\s*=\s*(")([^"\n]*)"/gm,
  rs: /^(?:pub(?:\([^)]*\))?\s+)?const\s+(\w+)\s*:\s*&(?:'static\s+)?str\s*=\s*(")([^"\n]*)"/gm,
};

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
const KEYWORD = /^(return|else|throw|new|await|yield|case|do|in|is|as)\b/;

function typedName(body: string, n: string): boolean {
  for (const m of body.matchAll(new RegExp(`\\s+${n}\\s*(?:=(?![=>])|;)`, 'g'))) {
    let s = m.index;
    while (s > 0 && /[\w<>[\],.?]/.test(body[s - 1])) s--;
    for (let p = s; p < m.index; p++)
      if ((p === s ? body[p - 1] !== '$' : '<>[],?'.includes(body[p - 1])) && !KEYWORD.test(body.slice(p, m.index))) return true;
  }
  return false;
}

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
  return (
    [`\\b(let|const|var|val|mut)\\s+${n}(?![\\w$])`, `(?<![\\w$.])${n}\\s*:=`, `(^|[\\n;{])[ \\t]*${n}\\s*(:[^=\\n]+)?=(?![=>])`].some(
      (p) => new RegExp(p).test(body),
    ) || typedName(body, n)
  );
}

const defaultIs = (ti: CodeFile, symbol: string) =>
  new RegExp(`export\\s+default\\s+(async\\s+)?(function\\s*\\*?\\s*|class\\s+)?${esc(symbol.split('.')[0])}\\b`).test(ti.code);

const label = (s: Src) => s.symbol ?? s.path;

function pyBindings(code: string, n: string, limit: number): number {
  let count = 0;
  for (const m of code.matchAll(
    new RegExp(`^([ \\t]*)(?:(?:(?:async\\s+)?def|class)\\s+${esc(n)}\\b|${esc(n)}\\s*(?::[^=\\n]*)?=(?!=))`, 'gm'),
  )) {
    let ind = m[1].length;
    let line = m.index;
    while (ind > 0 && line > 0) {
      line = code.lastIndexOf('\n', line - 2) + 1;
      const head = /^([ \t]*)(\S.*)/.exec(code.slice(line, code.indexOf('\n', line)));
      if (!head || head[1].length >= ind) continue;
      if (/^(?:async\s+)?(?:def|class)\b/.test(head[2])) break;
      ind = head[1].length;
    }
    if (ind === 0 && ++count >= limit) break;
  }
  return count;
}

const twice = (fi: CodeFile, imps: Import[], n: string) =>
  imps.filter((i) => i.local === n).length + (fi.lang === 'py' ? pyBindings(fi.code, n, 2) : 0) > 1;

function javaScopes(code: string, pos: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = pos, d = 0; i >= 0; i--) {
    if (code[i] === '}') d++;
    else if (code[i] === '{' && d-- === 0) {
      d = 0;
      const head = code.slice(Math.max(0, i - 300), i).trimEnd();
      const named = /\b(?:class|interface|enum|record)\s+(\w+)[^;{}]*$/.exec(head);
      if (named) out.push(named[1]);
      else if (i > 300 && !/[;{}]/.test(head)) {
        out.push(null);
        break;
      } else if (head.endsWith(')')) {
        let k = head.length - 1;
        for (let p = 0; k >= 0; k--)
          if (head[k] === ')') p++;
          else if (head[k] === '(' && --p === 0) break;
        if (/\bnew\s+[\w.<>[\]]+\s*$/.test(head.slice(0, k))) out.push(null);
      }
    }
  }
  return out;
}

function viaResult(root: string, from: Src, to: Src | undefined, via: string, read: Read, cache: Map<string, CodeFile | null>) {
  const longer = (where: string) => ({ result: 'unsure' as const, reason: `"${via}" is in ${where} only as part of a longer name` });
  const fi = codeFile(root, from.path, read, cache);
  const at = fi && (from.symbol ? locate(fi, from.symbol) : { start: 0, end: fi.keep.length });
  if (!fi || !at) return { result: 'not-checked' as const, reason: `${label(from)} is not in code that verify reads` };
  const own = viaHits(via, fi.keep, fi.code).filter((h) => h.at >= at.start && h.at < at.end);
  if (!own.some((h) => !h.near)) {
    const code = fi.code.slice(at.start, at.end);
    const fromName = from.symbol?.split('.').at(-1);
    let near = own.length > 0;
    const names: string[] = [];
    for (const m of fi.keep.matchAll(CONSTS[fi.lang])) {
      const hs = word(m[1]).test(code) ? viaHits(via, m[3], null) : [];
      if (hs.some((h) => !h.near)) names.push(m[1]);
      else if (hs.length) near = true;
    }
    if (!names.length) return near ? longer(label(from)) : { result: 'not-found' as const, reason: `"${via}" is not in ${label(from)}` };
    const local = names.find(
      (n) => shadows(code, n, fi.lang, fromName, !from.symbol) || new RegExp(`\\.\\s*${esc(n)}(?![\\w$])`).test(code),
    );
    if (local) return { result: 'unsure' as const, reason: `${label(from)} has a local or member named ${local}` };
  }
  if (!to) return { result: 'found' as const, reason: `"${via}" is in ${label(from)}` };
  const ti = codeFile(root, to.path, read, cache);
  const tb = ti && (to.symbol ? locate(ti, to.symbol) : { start: 0, end: ti.keep.length });
  if (!ti || !tb) return { result: 'not-checked' as const, reason: `${label(to)} is not in code that verify reads` };
  const lineAt = (k: number) =>
    ti.keep.slice(ti.keep.lastIndexOf('\n', k) + 1, ti.keep.indexOf('\n', k) < 0 ? undefined : ti.keep.indexOf('\n', k));
  const raw = viaHits(via, ti.keep, ti.code);
  const all = raw.filter((h) => !IMPORT_LINE[ti.lang].test(lineAt(h.at)) && !LOG_CALL.test(lineAt(h.at)));
  const hits = all.filter((h) => !h.near).map((h) => h.at);
  if (!hits.length && all.length) return longer(to.path);
  if (!hits.length && raw.length) return { result: 'unsure' as const, reason: `"${via}" is in ${to.path} only on an import or log line` };
  if (!hits.length) return { result: 'not-found' as const, reason: `"${via}" is not in ${to.path}` };
  const yes = { result: 'found' as const, reason: `"${via}" is in ${label(from)} and in ${label(to)}` };
  if (hits.some((k) => k >= tb.start && k < tb.end)) return yes;
  if (hits.some((k) => ti.code[k] !== ti.keep[k]) && [...ti.code.matchAll(FUNCS[ti.lang])].length <= 1) return yes;
  return { result: 'unsure' as const, reason: `"${via}" is in ${to.path} outside ${label(to)}` };
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
  const fromName = from.symbol?.split('.').at(-1);
  const used = (n: string) => word(n).test(body) && !shadows(body, n, fi.lang, fromName, whole);
  const names: string[] = [];
  let open: string | undefined;
  const imps = importsOf(root, fi, read);
  for (const i of imps) {
    if (i.local === '*' || i.local === '.') {
      const top = [
        ...ti.code.matchAll(
          /^(?:(?:async\s+)?def|class|func|type|var|const)\s+([\p{L}_][\p{L}\p{N}_]*)|^([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)/gmu,
        ),
      ]
        .map((m) => m[1] ?? m[2])
        .filter(used);
      if (fi.lang === 'py' && top.length) return { result: 'unsure' as const, reason: `${top[0]} can come from a star import` };
      if (i.path == null) open ??= top.length ? i.local : undefined;
      else names.push(...top.filter((n) => leadsTo(root, i.path!, to.path, n, read, cache) != null));
      continue;
    }
    if (!used(i.local)) continue;
    if (i.path == null) {
      open ??= i.local;
      continue;
    }
    const members =
      i.name === '*' && langOf(i.path) != null
        ? [...body.matchAll(new RegExp(`(?<![\\w$.])${esc(i.local)}\\s*\\.\\s*([\\w$]+)`, 'g'))].map((m) => m[1])
        : [i.name];
    const leads = members.map((m) => leadsTo(root, i.path!, to.path, m, read, cache));
    if (leads.some((r) => r != null && r !== '?')) names.push(i.local);
    else if (leads.includes('?')) open ??= i.local;
  }
  if (fi.lang === 'go' && dirname(from.path) === dirname(to.path) && from.path !== to.path)
    for (const m of ti.code.matchAll(/^(?:func|type|var|const)\s+([\p{L}_][\p{L}\p{N}_]*)/gmu)) names.push(m[1]);
  const hit = names.find(used);
  const who = label(from);
  if (hit && twice(fi, imps, hit)) return { result: 'unsure' as const, reason: `${hit} has two bindings` };
  if (hit) return { result: 'found' as const, reason: `${who} uses ${hit} from ${to.path}` };
  if (open) return { result: 'unsure' as const, reason: `the import of ${open} is not read` };
  return { result: 'not-found' as const, reason: `${who} does not use ${to.path}` };
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
  if (via != null && typeof via !== 'string') return skip('via is not a string');
  if (outside(root, from.path) || (to && outside(root, to.path))) return skip('a file is outside the root');
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
  const hint = () =>
    (fi.lang !== 'ts' && fi.lang !== 'py') ||
    from.path === to.path ||
    importsOf(root, fi, read).some((i) => i.path != null && leadsTo(root, i.path, to.path, i.name, read, cache) != null)
      ? ''
      : '; if this edge crosses a process, add via';
  let body = fi.code.slice(at.start, at.end);
  if (whole) body = body.replace(IMPORT_LINES, (m) => m.replace(/[^\n]/g, ' '));
  if (!to.symbol) {
    const r = fileResult(root, fi, ti, body, whole, from, to, read, cache);
    return r.result === 'not-found' ? { ...r, reason: r.reason + hint() } : r;
  }
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
  const pyStar = lang === 'py' && imps.some((i) => i.local === '*');
  const isDefault = defaultIs(ti, to.symbol);
  const wrapped = !isDefault && new RegExp(`\\bexport\\s+default\\b[^;]*${word(toName).source}`).test(ti.code);
  const reach = (path: string | null | undefined, name: string) => (path == null ? null : leadsTo(root, path, to.path, name, read, cache));
  const isCallee = (r: string | null) => r != null && (r === '*' || r === toName || (r === 'default' && isDefault));
  const names = new Set([toName]);
  for (const i of imps)
    if (
      i.name !== '*' &&
      word(i.local).test(body) &&
      (i.path == null
        ? i.name === toName || (i.name === 'default' && isDefault)
        : isCallee(reach(i.path, i.name)) || reach(i.path, i.name) === '?' || (wrapped && reach(i.path, i.name) === 'default'))
    )
      names.add(i.local);
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
        return byReach(reaches(cx, { kind: 'type', name: n, ctx: fi }, ownerDecl, owner, toName, to.path), 'with new');
      if ((lang === 'java' || lang === 'cs') && owner && /^\s*[(<]/.test(body.slice(idx + n.length))) {
        const st = new RegExp(`^\\s*(?:import|using)\\s+static\\s+([\\w.]+?)(?:\\.(${esc(n)}|\\*))?\\s*;`, 'gm');
        const statics = [...fi.keep.matchAll(st)].filter((m) => lang === 'cs' || m[2]);
        const exact = statics.filter((m) => m[2] === n);
        const named = (m: RegExpMatchArray) =>
          lang === 'java' && m[1].split('.').at(-1) === owner && to.path.endsWith(`${m[1].replace(/\./g, '/')}.java`);
        if (lang === 'java') {
          const scopes = javaScopes(fi.code, at.start + idx);
          if (!scopes.length) return unsure(`the class of ${who} is not known`);
          for (const s of scopes) {
            const d = s == null ? null : declIn(fi, s);
            if (!d) return unsure(`the class around ${n} is not read`);
            const up = ancestors(cx, d);
            if ([d, ...up.flatMap((a) => (a.d ? [a.d] : []))].some((x) => defines(cx, x, n)))
              return byReach(reaches(cx, { kind: 'type', name: d.name, ctx: fi }, ownerDecl, owner, toName, to.path), `on ${d.name}`);
            if (up.some((a) => !a.d)) return unsure(`a base of ${d.name} is not read`);
          }
          if (!statics.length) return not(`${who} does not call ${toName}`);
          return exact.length === 1 && named(exact[0]) ? found('through a static import') : unsure(`the static import of ${n} is not read`);
        }
        if (!fromContainer) return unsure(`the class of ${who} is not known`);
        const r = reaches(cx, { kind: 'type', name: fromContainer, ctx: fi }, ownerDecl, owner, toName, to.path);
        if (r === 'yes') return found('on this');
        if (!statics.length) return byReach(r, 'on this');
        const scope = fromParts.slice(0, -1).map((c) => declIn(fi, c));
        const clear = scope.every((d) => {
          const up = d && ancestors(cx, d);
          return up && up.every((a) => a.d) && [d, ...up.map((a) => a.d!)].every((x) => !defines(cx, x, n));
        });
        if (exact.length === 1 && named(exact[0]) && clear) return found('through a static import');
        return unsure(`the static import of ${n} is not read`);
      }
      if (lang === 'java' && owner && n !== owner) return ignore;
      if ((lang === 'java' || lang === 'cs' || lang === 'rs') && !owner && isUpper(n)) {
        const d = findType(cx, fi, n);
        if (d) return d.info.path === to.path ? found('as a type') : ignore;
        if (lang === 'rs') return unsure(`the type ${n} is not read`);
      }
      if (owner && (lang === 'ts' || lang === 'py' || lang === 'go' || lang === 'rs')) {
        if (lang === 'ts' && new RegExp(`\\{[^}]*\\b${esc(n)}\\b[^}]*\\}\\s*=\\s*this\\b`).test(body)) {
          if (!fromContainer) return unsure(`the class of ${who} is not known`);
          return byReach(reaches(cx, { kind: 'type', name: fromContainer, ctx: fi }, ownerDecl, owner, toName, to.path), 'through this');
        }
        if (lang !== 'rs' || !same || n !== toName || new RegExp(`^(pub\\s+)?fn\\s+${esc(n)}\\b`, 'm').test(fi.code)) return ignore;
        return unsure(`${n} has no path to ${owner}`);
      }
      const dynamic = new RegExp(`\\{[^}]*\\b${esc(n)}\\b[^}]*\\}\\s*=\\s*(?:await\\s+)?(?:import|require)\\(`).test(body);
      if ((shadowed || (n === toName && !dynamic && localType(cx, fi, body, n, lang, !whole))) && n !== fromName) return ignore;
      if (pyStar) return unsure(`${n} can come from a star import`);
      const bind = byLocal.get(n);
      if (bind && twice(fi, imps, n)) return unsure(`${n} has two bindings`);
      if (bind?.path === null) return unsure(`the import of ${n} is not read`);
      if (bind) {
        const r = reach(bind.path, bind.name);
        if (r === '?') return unsure(`${n} can come from a star import`);
        if (r === 'default' && wrapped) return unsure(`the default export wraps ${toName}`);
        if (!isCallee(r)) return ignore;
        if (r === '*') {
          const member = /^\s*\.\s*([\w$]+)/.exec(body.slice(idx + n.length))?.[1];
          if (member == null) return unsure(`the use of ${n} is not read`);
          if (member !== toName) return ignore;
        }
        return found(n === toName ? 'through an import' : 'through an alias');
      }
      if (same) return found('in the same file');
      const use = lang === 'rs' ? rustUses(fi, n, to.path) : 'no';
      if (use === 'yes') return found('through a use item');
      if (use === 'outside') return unsure(`the use of ${n} is not read`);
      const dots = imps.filter((i) => i.local === '.');
      if (dots.some((i) => isCallee(reach(i.path, n)))) return found('through a dot import');
      if (dots.some((i) => i.path == null)) return unsure(`the dot import of ${n} is not read`);
      return (lang === 'java' || lang === 'cs') && !owner ? unsure(`the import of ${n} is not read`) : ignore;
    }
    if (rc.complex) return unsure(rc.chain.length ? 'the receiver chain has a call' : 'the receiver is an expression');
    const chain = rc.chain;
    if (pyStar && !shadows(body, chain[0], lang, fromName, whole)) return unsure(`${chain[0]} can come from a star import`);
    if (owner && chain.length === 1 && chain[0] === owner)
      return byReach(reaches(cx, { kind: 'type', name: owner, ctx: fi }, ownerDecl, owner, toName, to.path), 'through its class');
    const rt = receiver(cx, fi, body, chain, fromContainer, fromDecl);
    if ((rt.kind === 'module' || rt.kind === 'value') && twice(fi, imps, chain[0])) return unsure(`${chain[0]} has two bindings`);
    if (rt.kind === 'rsmod') {
      if (owner && ownerDecl) return not(`${who} uses a module path for a method`);
      const use = rustUses(fi, chain[0], to.path);
      if (use === 'outside') return unsure(`the use of ${chain[0]} is not read`);
      return chain.at(-1) === rustMod(to.path) || (chain.length === 1 && use === 'yes')
        ? found('through a module path')
        : not(`${who} uses another module`);
    }
    if (rt.kind === 'module') {
      if (!rt.mod) return unsure(`the module of ${chain[0]} is not read`);
      if (owner && ownerDecl) return not(`${who} uses a module member for a method`);
      const r = reach(rt.mod, toName);
      if (r === '?') return unsure(`${toName} can come from a star import`);
      return isCallee(r) ? found('through a module') : not(`${who} uses another module`);
    }
    if (rt.kind === 'value') {
      if (owner) return unsure(`the type of ${chain.join('.')} is not read`);
      if (rt.mod == null) return unsure(`the module of ${chain[0]} is not read`);
      const r = reach(rt.mod, rt.name!);
      if (r === '?') return unsure(`${rt.name} can come from a star import`);
      return r != null ? found('through an imported value') : not(`${who} uses another value`);
    }
    if (rt.kind === 'super')
      return fromDecl && ancestors(cx, fromDecl).some((x) => x.name === owner)
        ? found('through super')
        : not(`${who} calls super of another class`);
    if (rt.kind !== 'type' || rt.name === '#top') return unsure(`the type of ${chain.join('.')} is not known`);
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
    while ((m = re.exec(body)) && verdicts.at(-1)?.res !== 'found') {
      const before = m.index < 200 ? body.slice(0, m.index) : '';
      if (!skippedDef && fromName === n && m.index < 200 && before.trim().length < 60 && !/(\.|::)\s*$/.test(before)) {
        skippedDef = true;
        continue;
      }
      verdicts.push(judge(n, m.index, shadowed));
    }
  }
  const pick = verdicts.find((v) => v.res === 'found') ?? verdicts.find((v) => v.res === 'unsure');
  if (pick) return { result: pick.res === 'found' ? 'found' : 'unsure', reason: pick.why };
  return { result: 'not-found', reason: `${who} does not call ${toName}${hint()}` };
}
