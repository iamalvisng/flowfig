import { basename, dirname } from 'node:path';
import { esc, matchClose, type CodeFile, type Lang } from './code.ts';
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

export { makeCtx, bindings, declIn, ancestors, file, findType, type Ctx, type Decl } from './type-index.ts';

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
      if (!chain.length && pre.endsWith(')')) {
        const before = pre.slice(0, openBack(pre, pre.length - 1)).replace(/\s+$/, '');
        const nw = /\bnew\s+([\w$.]+)\s*(?:<[^<>]*>)?$/.exec(before);
        if (nw && lang !== 'py' && lang !== 'go' && lang !== 'rs') return { chain: ['#new', nw[1]], complex: false };
        if (/\bsuper$/.test(before) && lang === 'py') return { chain: ['super'], complex: false };
      }
      return { chain, complex: true };
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
  'string number boolean any unknown void object int str float bool dict list set tuple bytes error byte rune int64 int32 uint float64 String Object Integer Long Boolean long double char Vec HashMap'.split(
    ' ',
  ),
);
const EXTERNAL = { name: '#external' };

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
    if (/^(\[|map\[|chan\b|func\b|interface\s*\{)/.test(t)) return EXTERNAL;
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

export function localType(cx: Ctx, info: CodeFile, text: string, n: string, lang: Lang): Local | null {
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
    let m = new RegExp(`(^|\\n)[ \\t]*${N}\\s*=\\s*(?:[\\w]+\\.)*([A-Z]\\w*)\\s*\\(`).exec(text);
    if (m) tries.push({ type: m[2] });
    m = new RegExp(`(^|\\n)[ \\t]*${N}\\s*=\\s*(?:[a-z_]\\w*\\.)*([A-Z]\\w*)\\.\\w+(\\.\\w+)*\\s*\\(`).exec(text);
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
      if (lang === 'rs' && (/^[a-z_]/.test(head) || head === 'crate')) return { kind: 'rsmod' };
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
  for (const seg of chain.slice(1)) {
    if (!cur || cur.kind === 'unknown') return unknown;
    if (cur.kind === 'module') {
      if (isUpper(seg) && lang !== 'go') cur = { kind: 'type', name: seg, ctx: (cur.mod && file(cx, cur.mod)) || fi };
      else if (lang === 'go' && cur.dir) return unknown;
      else if (cur.mod && lang === 'py' && resolvePy(cx.root, cur.mod, `.${seg}`, cx.read))
        cur = { kind: 'module', mod: resolvePy(cx.root, cur.mod, `.${seg}`, cx.read) };
      else return unknown;
      continue;
    }
    if (cur.kind !== 'type') return unknown;
    const d: Decl | null = cur.decl ?? findType(cx, cur.ctx!, cur.name, cur.qual);
    if (!d) return cur.name === '#external' ? cur : unknown;
    const ft = fieldType(cx, d, seg);
    if (!ft) return unknown;
    cur = typeFrom(cx, ft.type, lang, ft.ctx ?? d.info);
  }
  return cur ?? unknown;
}

function unread(cx: Ctx, rt: Rt): boolean {
  const ctx = rt.ctx;
  if (!ctx) return false;
  if (ctx.lang === 'go') return true;
  if (ctx.lang !== 'ts' && ctx.lang !== 'py') return false;
  return bindings(cx, ctx).has(rt.qual ? rt.qual.split('.')[0] : rt.name!);
}

export function reaches(cx: Ctx, rt: Rt, ownerDecl: Decl | null, owner: string, method: string, ownerPath: string): Reach {
  const lang = ownerDecl?.info.lang;
  if (rt.name === '#external') return 'no';
  if (rt.name === owner) {
    if (lang === 'go' && rt.qual) {
      const rd = findType(cx, rt.ctx!, rt.name, rt.qual);
      if (!rd) return 'unsure';
      if (dirname(rd.info.path) !== dirname(ownerPath)) return 'no';
    }
    if (lang === 'java' || lang === 'ts' || lang === 'py') {
      const rd = findType(cx, rt.ctx!, rt.name, rt.qual);
      if (rd && rd.info.path !== ownerPath) return 'no';
    }
    return 'yes';
  }
  if (!ownerDecl) return 'unsure';
  if (ancestors(cx, ownerDecl).some((a) => a.name === rt.name)) return 'yes';
  const rd = findType(cx, rt.ctx!, rt.name, rt.qual);
  if (lang === 'go' && rd?.kind === 'interface') {
    const need = goIfaceMethods(rd);
    const have = goMethods(cx, ownerDecl);
    return need.includes(method) && need.every((x) => have.has(x)) ? 'yes' : 'no';
  }
  if (!rd) return unread(cx, rt) ? 'unsure' : 'no';
  if (defines(cx, rd, method) && rd.info.path !== ownerPath) return 'no';
  for (const a of ancestors(cx, rd)) {
    if (a.name === owner) return 'yes';
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

export function rustUses(fi: CodeFile, n: string, tp: string): boolean {
  const mod = rustMod(tp);
  for (const m of fi.keep.matchAll(/\buse\s+([^;]+);/g)) {
    if (new RegExp(`\\b${esc(n)}\\b`).test(m[1]) && new RegExp(`\\b${esc(mod)}\\b`).test(m[1])) return true;
    if (new RegExp(`\\b${esc(mod)}::\\*`).test(m[1])) return true;
  }
  return false;
}

export const rustMod = (tp: string) => (basename(tp) === 'mod.rs' ? basename(dirname(tp)) : basename(tp, '.rs'));
