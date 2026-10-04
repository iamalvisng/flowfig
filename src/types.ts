import { dirname } from 'node:path';
import { esc, langOf, locate, matchClose, type CodeFile, type Lang } from './code.ts';
import { resolvePy } from './imports.ts';
import {
  ancestors,
  bindings,
  declIn,
  defines,
  file,
  findType,
  global,
  goDirFiles,
  goIfaceMethods,
  goMethods,
  lastSeg,
  type Bind,
  type Ctx,
  type Decl,
} from './type-index.ts';

export { makeCtx, bindings, declIn, ancestors, file, findType, rustMod, rustUses, type Ctx, type Decl } from './type-index.ts';

export type Reach = 'yes' | 'no' | 'unsure';
export type Rt = {
  kind: 'unknown' | 'type' | 'module' | 'value' | 'super' | 'rsmod';
  name?: string;
  qual?: string | null;
  ctx?: CodeFile;
  decl?: Decl | null;
  mod?: string | null;
  dir?: boolean;
};
type Local = { chain?: string[]; type?: string; ctor?: string; declared?: boolean };

const SELF = new Set(['this', 'self', 'cls', 'Self', 'base', 'super']);
export const isUpper = (s: string) => /^[A-Z]/.test(s);

function openBracket(text: string, idx: number): string | null {
  const d: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  for (let i = idx - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')' || c === ']' || c === '}') d[c]++;
    else if (c === '(' || c === '[' || c === '{') {
      const close = { '(': ')', '[': ']', '{': '}' }[c]!;
      if (d[close] > 0) d[close]--;
      else return c;
    }
  }
  return null;
}

function openBack(text: string, close: number): number {
  let d = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ')') d++;
    else if (text[i] === '(' && --d === 0) return i;
  }
  return 0;
}

export function receiverChain(body: string, idx: number, lang: Lang): { chain: string[]; complex: boolean } | null {
  let pre = body.slice(Math.max(0, idx - 300), idx);
  const sep = lang === 'rs' || lang === 'cs' || lang === 'java' ? /(\?\.|!\.|(?<!\.)\.|::)\s*$/ : /(\?\.|!\.|(?<!\.)\.)\s*$/;
  let m = sep.exec(pre);
  if (!m) return null;
  const chain: string[] = [];
  for (;;) {
    pre = pre.slice(0, m.index).replace(/\s+$/, '');
    if (/[)\]>]$/.test(pre)) {
      if (!pre.endsWith(')')) return { chain, complex: true };
      const before = pre.slice(0, openBack(pre, pre.length - 1)).replace(/\s+$/, '');
      const nw = /\bnew\s+([\w$.]+)\s*(?:<[^<>]*>)?$/.exec(before);
      if (nw && lang !== 'py' && lang !== 'go' && lang !== 'rs') return { chain: ['#new', nw[1], ...chain], complex: false };
      if (!chain.length && /\bsuper$/.test(before) && lang === 'py') return { chain: ['super'], complex: false };
      if (!/[\w$]$/.test(before)) return { chain, complex: true };
      chain.unshift('()');
      pre = before;
    }
    const id = /([A-Za-z_$][\w$]*)$/.exec(pre);
    if (!id) return { chain, complex: true };
    chain.unshift(id[1]);
    pre = pre.slice(0, id.index);
    m = sep.exec(pre);
    if (!m) return { chain, complex: false };
  }
}

const PRIM = new Set(
  'string number boolean void int str float bool dict list set tuple bytes byte rune int64 int32 uint float64 String Integer Long Boolean long double char Vec HashMap'.split(
    ' ',
  ),
);
const TOP = new Set(['any', 'unknown', 'object', 'Object', 'error', 'Any', 'dynamic']);
const EXTERNAL = { name: '#external' };
const TOP_TYPE = { name: '#top' };

export function normType(raw: string | undefined, lang: Lang): { name: string; qual?: string | null } | null {
  if (!raw) return null;
  let t = raw.trim().replace(/^(readonly|final|const)\s+/, '');
  if (lang === 'py') {
    t = t.replace(/^["']|["']$/g, '');
    const opt = /^Optional\[(.+)\]$/.exec(t);
    if (opt) t = opt[1];
    t =
      t
        .split('|')
        .map((x) => x.trim())
        .filter((x) => x && x !== 'None')[0] ?? '';
    if (/^(List|Dict|Set|Tuple|Iterable|Sequence|list|dict|set|tuple)\[/.test(t)) return EXTERNAL;
    t = t.replace(/\[.*$/, '');
  }
  if (lang === 'ts') {
    t = t.replace(/^typeof\s+/, '');
    const parts = t
      .split('|')
      .map((x) => x.trim())
      .filter((x) => x && !/^(null|undefined|void)$/.test(x));
    if (parts.length !== 1) return null;
    t = parts[0];
    if (t.endsWith('[]')) return EXTERNAL;
  }
  if (lang === 'go') {
    t = t.replace(/^\*+/, '');
    if (/^interface\s*\{/.test(t)) return TOP_TYPE;
    if (/^(\[|map\[|chan\b|func\b)/.test(t)) return EXTERNAL;
  }
  if (lang === 'rs') {
    for (;;) {
      const n = t.replace(/^&\s*('\w+\s+)?/, '').replace(/^(mut|dyn|impl)\s+/, '');
      const w = /^(Box|Arc|Rc|RefCell|Mutex)<(.+)>$/.exec(n);
      const next = w ? w[2] : n;
      if (next === t) break;
      t = next;
    }
  }
  if (lang === 'cs') t = t.replace(/\?$/, '');
  t = t.replace(/<.*$/, '').trim();
  if (lang === 'java' || lang === 'cs') t = t.replace(/\[\]$/, '');
  const m = /^([\w$]+(?:(?:\.|::)[\w$]+)*)$/.exec(t);
  if (!m) return null;
  const segs = m[1].split(/\.|::/);
  const name = segs.at(-1)!;
  if (TOP.has(name) && (segs.length === 1 || name === 'Any')) return TOP_TYPE;
  if (PRIM.has(name) && segs.length === 1) return EXTERNAL;
  return { name, qual: segs.length > 1 ? segs.slice(0, -1).join('.') : null };
}

const TYPE_RE = String.raw`[\w$.:]+(?:<[^;{}()=]*?>)?(?:\[\])?\??`;

function headOf(text: string, lang: Lang): string {
  if (lang === 'py') {
    const m = /:[ \t]*(#[^\n]*)?\n/.exec(text);
    return m ? text.slice(0, m.index) : text;
  }
  const i = text.search(/\{|=>/);
  return i < 0 ? text : text.slice(0, i);
}

const CALL: Record<Lang, (N: string) => RegExp> = {
  ts: (N) => new RegExp(`\\b(?:const|let|var)\\s+${N}\\s*=\\s*(?:await\\s+)?((?:this|[\\w$]+)(?:\\??\\.[\\w$]+)*)\\s*\\(`),
  py: (N) => new RegExp(`(?:^|\\n)[ \\t]*${N}\\s*=\\s*(?:await\\s+)?((?:self|\\w+)(?:\\.\\w+)*)\\s*\\(`),
  go: (N) => new RegExp(`(?:^|\\n)[ \\t]*${N}(?:\\s*,\\s*\\w+)*\\s*:?=\\s*(\\w+(?:\\.\\w+)*)\\s*\\(`),
  java: (N) => new RegExp(`\\bvar\\s+${N}\\s*=\\s*((?:this|\\w+)(?:\\.\\w+)*)\\s*\\(`),
  cs: (N) => new RegExp(`\\bvar\\s+${N}\\s*=\\s*(?:await\\s+)?((?:this|\\w+)(?:\\??\\.\\w+)*)\\s*\\(`),
  rs: (N) => new RegExp(`\\blet\\s+(?:mut\\s+)?${N}\\s*=\\s*((?:self|\\w+)(?:(?:\\.|::)\\w+)*)\\s*\\(`),
};

function callLocal(text: string, n: string, lang: Lang): Local | null {
  const N = esc(n);
  if ((text.match(new RegExp(`(?<![\\w$.])${N}\\s*(?:,\\s*\\w+\\s*)*:?=(?!=)`, 'g')) ?? []).length !== 1) return null;
  const m = CALL[lang](N).exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const after = text.slice(matchClose(text, open) + 1);
  if (!(lang === 'rs' ? /^\s*(\?|\.await)*\s*;/ : /^\s*!?\s*(;|\n|$)/).test(after)) return null;
  return { chain: [...m[1].split(/\??\.|::/), '()'] };
}

export function localType(cx: Ctx, info: CodeFile, text: string, n: string, lang: Lang): Local | null {
  const r = localType0(cx, info, text, n, lang);
  return r?.declared ? (callLocal(text, n, lang) ?? r) : r;
}

function localType0(cx: Ctx, info: CodeFile, text: string, n: string, lang: Lang): Local | null {
  const head = headOf(text, lang);
  const N = esc(n);
  const NB = `(?<![\\w$.])${N}`;
  const tries: { type?: string; ctor?: string }[] = [];
  const inHead = (re: RegExp) => re.test(head);
  const isLocal = (x: string) => new RegExp(`\\b(const|let|var)\\s+([[{][^=]*)?${esc(x)}\\b|(?<![\\w$.])${esc(x)}\\s*[,)=:]`).test(text);
  const chainRe = {
    ts: `\\b(?:const|let|var)\\s+${N}\\s*=\\s*(?:await\\s+)?((?:this|[\\w$]+)(?:\\??\\.[\\w$]+)+)\\s*;`,
    py: `(?:^|\\n)[ \\t]*${N}\\s*=\\s*((?:self|\\w+)(?:\\.\\w+)+)[ \\t]*(?=\\n)`,
    go: `${NB}\\s*:?=\\s*(\\w+(?:\\.\\w+)+)[ \\t]*(?=\\n)`,
    rs: `\\blet\\s+(?:mut\\s+)?${N}\\s*=\\s*&?\\s*(\\w+(?:\\.\\w+)+)\\s*;`,
    java: `\\bvar\\s+${N}\\s*=\\s*((?:this|\\w+)(?:\\.\\w+)+)\\s*;`,
    cs: `\\bvar\\s+${N}\\s*=\\s*((?:this|\\w+)(?:\\??\\.\\w+)+)\\s*;`,
  }[lang];
  const cm = new RegExp(chainRe).exec(text);
  if (cm) return { chain: cm[1].split(/\??\./) };
  if (lang === 'ts') {
    const cast = new RegExp(`\\b(?:const|let|var)\\s+${N}\\s*=[^;\\n]*?\\bas\\s+([\\w$.]+)\\s*;?[ \\t]*(?=\\n)`).exec(text);
    if (cast) tries.push({ type: cast[1] });
    for (const m of text.matchAll(new RegExp(`${NB}\\s*\\??\\s*:\\s*(${TYPE_RE}(?:\\s*\\|\\s*${TYPE_RE})*)`, 'g'))) {
      const pre = text.slice(0, m.index);
      if (
        /\b(const|let|var)\s*$/.test(pre) ||
        (openBracket(text, m.index) === '(' && /[(,]\s*((public|private|protected|readonly)\s+)*$/.test(pre))
      )
        tries.push({ type: m[1] });
    }
    let m = new RegExp(`\\b(?:const|let|var)\\s+${N}\\s*=\\s*(?:await\\s+)?new\\s+([\\w$.]+)`).exec(text);
    if (m && !isLocal(m[1])) tries.push({ type: m[1] });
    else if (m && !tries.length) return { declared: true };
    m = new RegExp(`\\b(?:const|let|var)\\s+${N}\\s*=\\s*(?:await\\s+)?([A-Z][\\w$]*)\\.[\\w$]+\\s*[(<]`).exec(text);
    if (m && (bindings(cx, info).has(m[1]) || declIn(info, m[1]))) tries.push({ type: m[1] });
    if (
      !tries.length &&
      (new RegExp(
        `\\b(const|let|var)\\s+(${N}\\b|[[{][^=]*${NB}\\b)|\\bfor\\s*\\(\\s*(const|let|var)\\s+${N}\\b|\\bcatch\\s*\\(\\s*${N}\\b`,
      ).test(text) ||
        inHead(new RegExp(`${NB}\\s*[,)=?]`)))
    )
      return { declared: true };
  } else if (lang === 'py') {
    for (const m of text.matchAll(new RegExp(`${NB}\\s*:\\s*([\\w.\\[\\]"' |]+?)\\s*[,)=\\n]`, 'g'))) {
      const pre = text.slice(0, m.index);
      if (/\blambda\b[^:]*$/.test(pre)) continue;
      if (m.index < head.length || /(^|\n)[ \t]*$/.test(pre)) tries.push({ type: m[1] });
    }
    let m = new RegExp(`(^|\\n)[ \\t]*${N}\\s*=\\s*((?:[\\w]+\\.)*[A-Z]\\w*)\\s*\\(`).exec(text);
    if (m) tries.push({ type: m[2] });
    m = new RegExp(`(^|\\n)[ \\t]*${N}\\s*=\\s*((?:[a-z_]\\w*\\.)*[A-Z]\\w*)\\.\\w+(\\.\\w+)*\\s*\\(`).exec(text);
    if (m) tries.push({ type: m[2] });
    if (
      !tries.length &&
      (new RegExp(`(^|\\n)[ \\t]*${N}\\s*(,[^=\\n]*)?=[^=]|\\bfor\\s+([\\w, ]*,\\s*)?${N}\\b|\\bas\\s+${N}\\b`).test(text) ||
        inHead(new RegExp(`${NB}\\s*[,)=]`)))
    )
      return { declared: true };
  } else if (lang === 'go') {
    for (const m of head.matchAll(new RegExp(`${NB}(?:\\s*,\\s*\\w+)*\\s+(\\*?[\\w.]+)`, 'g')))
      if (openBracket(head, m.index) === '(') tries.push({ type: m[1] });
    let m = new RegExp(`\\bvar\\s+${N}\\s+(\\*?[\\w.]+)`).exec(text);
    if (m) tries.push({ type: m[1] });
    m = new RegExp(`${NB}(?:\\s*,\\s*\\w+)*\\s*:?=\\s*&?([\\w.]+)\\s*\\{`).exec(text);
    if (m) tries.push({ type: m[1] });
    m = new RegExp(`${NB}(?:\\s*,\\s*\\w+)*\\s*:=\\s*((?:\\w+\\.)?New\\w*)\\s*\\(`).exec(text);
    if (m) tries.push({ ctor: m[1] });
    if (!tries.length && new RegExp(`${NB}(\\s*,\\s*\\w+)*\\s*:=|\\b\\w+\\s*,\\s*${N}\\s*(,\\s*\\w+\\s*)*:=|\\bvar\\s+${N}\\b`).test(text))
      return { declared: true };
  } else if (lang === 'java' || lang === 'cs') {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.])([A-Z][\\w.]*(?:<[^;(){}=]*?>)?(?:\\[\\])?\\??)\\s+${N}\\s*[=;,):]`, 'g')))
      if (!/\b(new|return|throw)\s*$/.test(text.slice(0, m.index))) tries.push({ type: m[1] });
    const m = new RegExp(`\\bvar\\s+${N}\\s*=\\s*new\\s+([\\w.]+)`).exec(text);
    if (m) tries.push({ type: m[1] });
    if (
      !tries.length &&
      new RegExp(
        `\\bvar\\s+${N}\\b|\\b(out\\s+var|foreach\\s*\\(\\s*var)\\s+${N}\\b|${NB}\\s*=>|\\(\\s*${N}\\s*,|,\\s*${N}\\s*\\)\\s*->|${NB}\\s*->`,
      ).test(text)
    )
      return { declared: true };
  } else if (lang === 'rs') {
    for (const m of text.matchAll(
      new RegExp(`${NB}\\s*:\\s*((?:&\\s*(?:'\\w+\\s+)?)?(?:mut\\s+)?(?:dyn\\s+|impl\\s+)?[\\w:]+(?:<[^;{}=]*?>)?)`, 'g'),
    )) {
      const pre = text.slice(0, m.index);
      if (openBracket(text, m.index) === '(' || /\blet\s+(mut\s+)?$/.test(pre)) tries.push({ type: m[1] });
    }
    const m = new RegExp(
      `\\b(?:let\\s+(?:mut\\s+)?|let\\s+Some\\(\\s*(?:mut\\s+)?|for\\s+(?:mut\\s+)?|Some\\(\\s*)${N}\\s*\\)?\\s*(?:=|\\bin\\b)\\s*(?:&\\s*)?([A-Z]\\w*)\\s*(::|\\{)`,
    ).exec(text);
    if (m) tries.push({ type: m[1] });
    if (
      !tries.length &&
      new RegExp(`\\blet\\s+(mut\\s+)?${N}\\b|\\bfor\\s+${N}\\b|Some\\(\\s*${N}\\s*\\)|\\|[^|]*${NB}\\b[^|]*\\|`).test(text)
    )
      return { declared: true };
    for (const t of tries) {
      const g = /^(?:&\s*)?(?:mut\s+)?([A-Z])$/.exec(t.type!.trim());
      const bound = g && new RegExp(`[<,]\\s*${g[1]}\\s*:\\s*([\\w:]+)`).exec(head);
      if (bound) t.type = bound[1];
    }
  }
  if (lang === 'ts' || lang === 'java')
    for (const t of tries) {
      const bound = t.type && new RegExp(`[<,]\\s*${esc(t.type.trim())}\\s+extends\\s+([\\w$.]+)`).exec(head);
      if (bound) t.type = bound[1];
    }
  if (new Set(tries.map((t) => t.type ?? t.ctor)).size > 1) return { declared: true };
  return tries[0] ?? null;
}

function fieldType(cx: Ctx, d: Decl | null, f: string, depth = 0): { type: string; ctx?: CodeFile } | null {
  if (!d) return null;
  const { info } = d;
  const lang = info.lang;
  const body = info.code.slice(d.start, d.end);
  const src = info.keep.slice(d.start, d.end);
  const F = esc(f);
  let m;
  if (lang === 'ts') {
    m = new RegExp(
      `(^|[\\n;{])[ \\t]*(@[\\w.]+(\\([^)]*\\))?\\s*)*((public|private|protected|static|readonly|declare|override)\\s+)*${F}\\s*[?!]?\\s*:\\s*(${TYPE_RE}(?:\\s*\\|\\s*${TYPE_RE})*)`,
    ).exec(body);
    if (m) return { type: m[6] };
    m = new RegExp(`\\b(public|private|protected|readonly)\\s+(readonly\\s+)?${F}\\s*\\??\\s*:\\s*(${TYPE_RE})`).exec(body);
    if (m) return { type: m[3] };
    m = new RegExp(`\\bthis\\.${F}\\s*=\\s*new\\s+([\\w$.]+)`).exec(body);
    if (m) return { type: m[1] };
  } else if (lang === 'py') {
    m = new RegExp(`\\bself\\.${F}\\s*(?::\\s*([\\w.\\[\\]"' |]+?)\\s*)?=\\s*(?:[a-z_]\\w*\\.)*([A-Z]\\w*)\\s*\\(`).exec(src);
    if (m) return { type: m[1] ?? m[2] };
    m = new RegExp(`\\n[ \\t]+(?:self\\.)?${F}\\s*:\\s*([\\w.\\[\\]"' |]+?)\\s*[=\\n]`).exec(src);
    if (m) return { type: m[1] };
  } else if (lang === 'go') {
    m = new RegExp(`\\n[ \\t]*${F}(?:\\s*,\\s*\\w+)*[ \\t]+(\\*?[\\w.\\[\\]]+)`).exec(body);
    if (m) return { type: m[1] };
    m = new RegExp(`\\n[ \\t]*\\*?((?:\\w+\\.)?${F})[ \\t]*(?=\\n)`).exec(body);
    if (m) return { type: m[1] };
  } else if (lang === 'java' || lang === 'cs') {
    m = new RegExp(`(?<![\\w.])([A-Z][\\w.]*(?:<[^;(){}=]*?>)?(?:\\[\\])?\\??)\\s+${F}\\s*(?:[;=]|\\{\\s*get)`).exec(body);
    if (m) return { type: m[1] };
    if (lang === 'cs') {
      const h = new RegExp(`\\b${esc(d.name)}\\s*(?:<[^>]*>)?\\s*\\(([^)]*)\\)`).exec(body.slice(0, body.indexOf('{') + 1 || 400));
      const p = h && new RegExp(`([A-Z][\\w.]*(?:<[^,()]*?>)?\\??)\\s+${F}\\s*(,|$)`).exec(h[1]);
      if (p) return { type: p[1] };
    }
  } else if (lang === 'rs') {
    m = new RegExp(`(?<![\\w])(?:pub(?:\\([^)]*\\))?\\s+)?${F}\\s*:\\s*([^,\\n}]+)`).exec(body);
    if (m) return { type: m[1].trim() };
  }
  if (depth > 0) return null;
  for (const a of ancestors(cx, d).slice(0, 4)) {
    const r = fieldType(cx, a.d, f, 1);
    if (r && a.d) return { ...r, ctx: a.d.info };
  }
  return null;
}

function goCtorType(cx: Ctx, info: CodeFile, ctor: string): { type: string; ctx: CodeFile } | null {
  const [q, fn] = ctor.includes('.') ? ctor.split('.') : [null, ctor];
  let dir = dirname(info.path);
  if (q) {
    const b = bindings(cx, info).get(q);
    if (!b?.mod) return null;
    dir = b.mod;
  }
  for (const f of goDirFiles(cx, dir)) {
    const m = new RegExp(`\\bfunc\\s+${esc(fn)}\\s*(\\[[^\\]]*\\])?\\s*\\(`).exec(f.code);
    if (!m) continue;
    const close = matchClose(f.code, m.index + m[0].length - 1);
    const r = /^\s*\(?\s*\*?([\w.]+)/.exec(f.code.slice(close + 1));
    return r ? { type: r[1], ctx: f } : null;
  }
  return null;
}

function topLevel(fi: CodeFile): string {
  const c = fi.code;
  if (fi.lang === 'py')
    return c
      .split('\n')
      .filter((l) => /^\S/.test(l))
      .join('\n');
  let d = 0;
  let out = '';
  for (const ch of c) {
    if (ch === '{') d++;
    if (d === 0) out += ch;
    if (ch === '}') d--;
  }
  return out;
}

function rustUnwrap(cx: Ctx, raw: string, depth: number): string {
  const strip = (s: string) =>
    s
      .trim()
      .replace(/^&\s*('\w+\s+)?/, '')
      .replace(/^(mut|dyn|impl)\s+/, '');
  let t = strip(strip(raw));
  if (depth > 4) return t;
  const g = global(cx, 'rs');
  const w = /^([\w:]+)<(.+)>$/.exec(t);
  if (w) {
    const W = lastSeg(w[1]);
    let d = 0;
    let arg = '';
    for (const ch of w[2]) {
      if (ch === '<') d++;
      if (ch === '>') d--;
      if (ch === ',' && d === 0) break;
      arg += ch;
    }
    arg = arg.trim();
    if (/^'\w+$/.test(arg)) return rustUnwrap(cx, W, depth + 1);
    if (!g.types.has(W) && !g.impls.has(W) && !g.aliases.has(W)) return rustUnwrap(cx, arg, depth + 1);
    t = W;
  }
  const alias = g.aliases.get(lastSeg(t.replace(/<.*$/, '')));
  return alias ? rustUnwrap(cx, alias, depth + 1) : t;
}

function typeFrom(cx: Ctx, raw: string, lang: Lang, ctx: CodeFile): Rt {
  const n = normType(lang === 'rs' ? rustUnwrap(cx, raw, 0) : raw, lang);
  return n ? { kind: 'type', name: n.name, qual: n.qual, ctx } : { kind: 'unknown' };
}

const NO_RT: Rt = { kind: 'unknown' };
const MODIFIER = /^(public|private|protected|static|internal|async|override|virtual|abstract|new|final|sealed|extern)$/;

function returnOf(cx: Ctx, f: CodeFile, at: { start: number; end: number }, method: boolean): Rt {
  const { code, lang } = f;
  let s = at.start;
  for (let nl = code.indexOf('\n', s); /^[ \t]*(@|\[|#\[)/.test(code.slice(s, s + 3)) && nl > 0 && nl < at.end; nl = code.indexOf('\n', s))
    s = nl + 1;
  if (lang === 'go' && !method && !/^func\s+\w/.test(code.slice(s, s + 40))) return NO_RT;
  let i = code.indexOf('(', s);
  if (lang === 'go' && /^func\s*\(/.test(code.slice(s, s + 20))) i = code.indexOf('(', matchClose(code, i) + 1);
  if (i < 0 || i >= at.end || /[{;]|\b(class|interface|struct|enum|trait)\b/.test(code.slice(s, i))) return NO_RT;
  const tail = code.slice(matchClose(code, i) + 1, at.end);
  let raw: string | undefined;
  if (lang === 'ts') raw = /^\s*:\s*([^{=;]+?)\s*(?:\{|=>|;|$)/.exec(tail)?.[1];
  else if (lang === 'py') raw = /^\s*->\s*([^:\n]+?)\s*:/.exec(tail)?.[1];
  else if (lang === 'rs') raw = /^\s*->\s*([^{;]+?)\s*(?:where\b[^{;]*)?(?:\{|;|$)/.exec(tail)?.[1];
  else if (lang === 'go') {
    const open = /^[ \t]*\(/.exec(tail);
    if (open) {
      const parts = tail.slice(open[0].length, matchClose(tail, open[0].length - 1)).split(',');
      const word = '(?!(?:chan|func|map|interface|struct)\\b)\\w+';
      const named = parts.some((p) => new RegExp(`^\\s*${word}\\s+\\S`).test(p));
      raw = named ? new RegExp(`^\\s*${word}\\s+(\\*?[\\w.]+)\\s*$`).exec(parts[0])?.[1] : parts[0].trim();
    } else raw = /^[ \t]*(\*?[\w.]+)[ \t]*(?:\{|\n|$)/.exec(tail)?.[1];
  } else {
    raw = /([A-Za-z_][\w.]*(?:<[^()]*>)?(?:\[\])?\??)\s+[\w$]+\s*(?:<[^()]*>)?\s*$/.exec(code.slice(s, i))?.[1];
    if (raw && MODIFIER.test(raw)) raw = undefined;
  }
  if (!raw || /\b(any|unknown|object|Object)\b|interface\s*\{/.test(raw)) return NO_RT;
  const wrap = {
    ts: /^(?:Promise|PromiseLike|Awaited)<([\s\S]*)>$/,
    java: /^(?:Optional|CompletableFuture)<([\s\S]*)>$/,
    cs: /^(?:Task|ValueTask)<([\s\S]*)>$/,
  }[lang as 'ts' | 'java' | 'cs'];
  const rt = typeFrom(cx, wrap?.exec(raw)?.[1] ?? raw, lang, f);
  return rt.kind === 'type' && (rt.name === '#external' || findType(cx, f, rt.name, rt.qual)) ? rt : NO_RT;
}

function fnReturn(cx: Ctx, files: CodeFile[], name: string): Rt {
  for (const f of files) {
    const at = locate(f, name);
    if (at) return returnOf(cx, f, at, false);
  }
  return NO_RT;
}

function methodReturn(cx: Ctx, d: Decl, name: string): Rt {
  const N = esc(name);
  const dup = new RegExp(`(?:^|[\\n;{}>\\]?])[ \\t]*(?:[\\w.<>\\[\\]?,]+[ \\t]+)*${N}[ \\t]*[<(]`, 'g');
  for (const x of [d, ...ancestors(cx, d).map((a) => a.d)]) {
    if (!x || !defines(cx, x, name)) continue;
    if ((x.info.code.slice(x.start, x.end).match(dup) ?? []).length > 1) return NO_RT;
    for (const f of x.info.lang === 'go' ? goDirFiles(cx, dirname(x.info.path)) : [x.info]) {
      const at = locate(f, `${x.name}.${name}`);
      if (at) return returnOf(cx, f, at, true);
    }
    return NO_RT;
  }
  return NO_RT;
}

function importedValueType(cx: Ctx, b: Bind): Rt | null {
  const mi = file(cx, b.mod!);
  if (!mi) return null;
  let name: string | undefined = b.imported;
  if (name === 'default') name = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*(\n|$)/.exec(mi.code)?.[1];
  if (!name || declIn(mi, name)) return null;
  const lt = localType(cx, mi, topLevel(mi), name, mi.lang);
  return lt?.type ? typeFrom(cx, lt.type, mi.lang, mi) : null;
}

export function receiver(
  cx: Ctx,
  fi: CodeFile,
  body: string,
  chain: string[],
  fromContainer: string | null,
  fromDecl: Decl | null,
  depth = 0,
): Rt {
  const lang = fi.lang;
  const unknown: Rt = { kind: 'unknown' };
  const head = chain[0];
  const imps = bindings(cx, fi);
  let cur: Rt | null = null;
  const goRecv = lang === 'go' ? /^\s*func\s*\(\s*(\w+)\s+\*?\w+/.exec(body)?.[1] : null;
  if (head === '#new') {
    cur = typeFrom(cx, chain[1], lang, fi);
    chain = chain.slice(1);
  } else if (SELF.has(head) || head === goRecv) {
    if (!fromContainer) return unknown;
    if (head === 'super' || head === 'base') {
      if (chain.length > 1) return unknown;
      return fromDecl ? { kind: 'super' } : unknown;
    }
    cur = { kind: 'type', name: fromContainer, ctx: fi, decl: fromDecl };
  } else if (chain[1] === '()') {
    const b = imps.get(head);
    const mi = b?.mod && !b.dir && b.imported !== '*' && b.imported !== 'default' ? file(cx, b.mod) : null;
    if (lang === 'py' && isUpper(b?.imported ?? head)) cur = { kind: 'type', name: b?.imported ?? head, ctx: fi };
    else if (b) cur = mi ? fnReturn(cx, [mi], b.imported) : unknown;
    else cur = fnReturn(cx, lang === 'go' ? goDirFiles(cx, dirname(fi.path)) : [fi], head);
  } else {
    const lt = localType(cx, fi, body, head, lang);
    if (lt?.chain && depth < 3 && lt.chain[0] !== head) cur = receiver(cx, fi, body, lt.chain, fromContainer, fromDecl, depth + 1);
    else if (lt?.chain) return unknown;
    else if (lt?.type) cur = typeFrom(cx, lt.type, lang, fi);
    else if (lt?.ctor) {
      const c = goCtorType(cx, fi, lt.ctor);
      cur = c ? typeFrom(cx, c.type, lang, c.ctx) : unknown;
    } else if (lt?.declared && !imps.has(head)) return unknown;
    else {
      const b = imps.get(head);
      if (lang === 'rs' && (/^[a-z_]/.test(head) || head === 'crate')) return chain.includes('()') ? unknown : { kind: 'rsmod' };
      const iv = b?.mod && !b.dir && b.imported !== '*' ? importedValueType(cx, b) : null;
      if (iv) cur = iv;
      else if (b) {
        if (b.dir || b.imported === '*') cur = { kind: 'module', mod: b.mod, dir: b.dir };
        else if (b.imported === 'default' && !isUpper(head)) cur = { kind: 'value', name: head, mod: b.mod };
        else if (isUpper(b.imported === 'default' ? head : b.imported))
          cur = { kind: 'type', name: b.imported === 'default' ? head : b.imported, ctx: fi };
        else cur = { kind: 'value', name: b.imported, mod: b.mod };
      } else if ((lang === 'java' || lang === 'cs') && fromDecl && fieldType(cx, fromDecl, head)) {
        const ft = fieldType(cx, fromDecl, head)!;
        cur = typeFrom(cx, ft.type, lang, ft.ctx ?? fromDecl.info);
      } else if (isUpper(head) && lang !== 'go') cur = { kind: 'type', name: head, ctx: fi };
      else {
        const fl = localType(cx, fi, topLevel(fi), head, lang);
        if (fl?.type) cur = typeFrom(cx, fl.type, lang, fi);
        else return unknown;
      }
    }
  }
  for (let i = 1; i < chain.length; i++) {
    const seg = chain[i];
    if (seg === '()') continue;
    const isCall = chain[i + 1] === '()';
    if (!cur || cur.kind === 'unknown') return unknown;
    if (cur.kind === 'module') {
      if (isUpper(seg) && lang !== 'go') cur = { kind: 'type', name: seg, ctx: (cur.mod && file(cx, cur.mod)) || fi };
      else if (isCall && cur.mod) {
        const mf = lang === 'go' ? goDirFiles(cx, cur.mod) : [file(cx, cur.mod)].filter((f) => f != null);
        cur = fnReturn(cx, mf, seg);
      } else if (lang === 'go' && cur.dir) return unknown;
      else if (cur.mod && lang === 'py' && resolvePy(cx.root, cur.mod, `.${seg}`, cx.read))
        cur = { kind: 'module', mod: resolvePy(cx.root, cur.mod, `.${seg}`, cx.read) };
      else return unknown;
      continue;
    }
    if (cur.kind !== 'type') return unknown;
    const d: Decl | null = cur.decl ?? findType(cx, cur.ctx!, cur.name, cur.qual);
    if (!d) return cur.name === '#external' && !isCall ? cur : unknown;
    if (isCall) {
      cur = methodReturn(cx, d, seg);
      continue;
    }
    const ft = fieldType(cx, d, seg);
    if (!ft) return unknown;
    cur = typeFrom(cx, ft.type, lang, ft.ctx ?? d.info);
  }
  if (cur && cur.kind !== 'type' && chain.includes('()')) return unknown;
  return cur ?? unknown;
}

const TS_GLOBALS = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Array',
  'ReadonlyArray',
  'ReadonlyMap',
  'Promise',
  'Date',
  'RegExp',
  'Error',
  'Record',
]);
const tsMethods = (d: Decl) =>
  [
    ...d.info.code
      .slice(d.start, d.end)
      .matchAll(/(?:^|[\n;{,])[ \t]*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*(?::\s*)?(?:<[^>]*>\s*)?\(/g),
  ].map((m) => m[1]);
const pyMethods = (d: Decl) => [...d.info.code.slice(d.start, d.end).matchAll(/\n[ \t]+(?:async\s+)?def\s+(\w+)/g)].map((m) => m[1]);

export function reaches(cx: Ctx, rt: Rt, ownerDecl: Decl | null, owner: string, method: string, ownerPath: string): Reach {
  if (rt.name === '#top') return 'unsure';
  if (rt.name === '#external') return 'no';
  const lang = langOf(ownerPath);
  const ambiguous = (name: string) => lang === 'rs' && (global(cx, 'rs').types.get(name)?.length ?? 0) > 1;
  const same = (a: Decl, b: Decl) =>
    a.name === b.name && (lang === 'go' ? dirname(a.info.path) === dirname(b.info.path) : a.info.path === b.info.path);
  const match = (a: { name: string; d: Decl | null }, d: Decl | null): Reach => {
    if (ambiguous(a.name)) return 'unsure';
    if (a.d && d) return same(a.d, d) ? 'yes' : 'no';
    return lang === 'rs' && d ? 'yes' : 'unsure';
  };
  const rd = findType(cx, rt.ctx!, rt.name, rt.qual);
  if (rt.name === owner) {
    if (!rd) return lang === 'rs' && !global(cx, 'rs').types.has(owner) ? 'yes' : 'unsure';
    const own =
      lang === 'go' ? dirname(rd.info.path) === dirname(ownerPath) : rd.info.path === ownerPath || (lang === 'rs' && !ambiguous(owner));
    if (own) return 'yes';
    if (rd.kind !== 'interface') return 'no';
  }
  if (!ownerDecl) return 'unsure';
  const anc = ancestors(cx, ownerDecl);
  for (const a of anc.filter((x) => x.name === rt.name)) {
    const r = match(a, rd);
    if (r !== 'no') return r;
  }
  if (!rd) {
    if (lang === 'ts' && TS_GLOBALS.has(rt.name!) && !rt.qual && !bindings(cx, rt.ctx!).has(rt.name!)) return 'no';
    const nominal =
      (lang === 'java' || lang === 'cs') &&
      !global(cx, lang).types.has(rt.name!) &&
      anc.every((a) => a.d) &&
      !new RegExp(`<[^<>()]*\\b${esc(rt.name!)}\\b`).test(rt.ctx?.code ?? '') &&
      (lang === 'cs' || new RegExp(`^\\s*import\\s+[\\w.]+\\.${esc(rt.name!)}\\s*;`, 'm').test(rt.ctx?.keep ?? ''));
    return nominal ? 'no' : 'unsure';
  }
  if (lang === 'go' && rd.kind === 'interface') {
    const ra = ancestors(cx, rd);
    const need = [...goIfaceMethods(rd), ...ra.flatMap((a) => (a.d ? goIfaceMethods(a.d) : []))];
    const have = new Set([...goMethods(cx, ownerDecl), ...anc.flatMap((a) => (a.d ? [...goMethods(cx, a.d)] : []))]);
    const needOpen = ra.some((a) => !a.d);
    const haveOpen = anc.some((a) => !a.d);
    if (need.some((x) => !have.has(x)) && !haveOpen) return 'no';
    if (!need.includes(method) && !needOpen) return 'no';
    return needOpen || haveOpen ? 'unsure' : 'yes';
  }
  const shape =
    lang === 'ts' && rd.kind === 'interface'
      ? tsMethods(rd)
      : lang === 'py' && ancestors(cx, rd).some((a) => a.name === 'Protocol')
        ? pyMethods(rd)
        : null;
  if (shape?.includes(method) && shape.every((m) => defines(cx, ownerDecl, m))) return 'unsure';
  if (defines(cx, rd, method) && rd.info.path !== ownerPath) return 'no';
  for (const a of ancestors(cx, rd)) {
    if (a.name === owner) {
      const r = match(a, ownerDecl);
      if (r !== 'no') return r;
    }
    if (a.d && defines(cx, a.d, method) && a.d.info.path !== ownerPath) return 'no';
  }
  return 'no';
}

export function inTypePosition(body: string, idx: number, lang: Lang): boolean {
  const pre = body.slice(Math.max(0, idx - 120), idx);
  if (lang !== 'ts' && lang !== 'py' && lang !== 'rs') return false;
  if (/[\w$\]}]\s*\??\s*:\s*$/.test(pre) && openBracket(body, idx) === '(') return true;
  if (/\b(const|let|var)\s+[\w$]+\s*:\s*$/.test(pre)) return true;
  if (/\)[ \t]*->[ \t]*$/.test(pre) || (lang === 'ts' && /\)[ \t]*:[ \t]*$/.test(pre))) return true;
  if (lang === 'ts' && /\bas\s+$/.test(pre)) return true;
  if (lang === 'py' && /(^|\n)[ \t]*[\w.]+\s*:\s*$/.test(pre)) return true;
  return /:\s*[\w$.]+<\s*$/.test(pre) || /(Optional|List)\[\s*$/.test(pre);
}
