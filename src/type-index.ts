import { basename, dirname, posix, resolve } from 'node:path';
import { codeFile, esc, locate, matchClose, pyBody, readFile, type CodeFile, type Lang, type Read } from './code.ts';
import { importsOf, resolveTs } from './imports.ts';

export type Decl = { info: CodeFile; start: number; end: number; name: string; kind: 'class' | 'interface'; dir?: string };
export type Bind = { mod: string | null; imported: string; dir: boolean };
type Globals = {
  types: Map<string, string[]>;
  impls: Map<string, Set<string>>;
  aliases: Map<string, string>;
  usings: Set<string>;
  projects: string[];
};
type Index = { types: Map<string, Decl | null>; binds: Map<string, Map<string, Bind>>; repo: string[] | null; globals: Map<Lang, Globals> };
type Cache = Map<string, CodeFile | null>;
export type Ctx = { root: string; read: Read; cache: Cache; ix: Index };

const indexes = new WeakMap<Cache, Index>();

export function makeCtx(root: string, read: Read = readFile, cache: Cache = new Map()): Ctx {
  let ix = indexes.get(cache);
  if (!ix) indexes.set(cache, (ix = { types: new Map(), binds: new Map(), repo: null, globals: new Map() }));
  return { root, read, cache, ix };
}

export const lastSeg = (s: string) => s.split(/\.|::/).at(-1)!;

export const file = (cx: Ctx, path: string) => codeFile(cx.root, path, cx.read, cx.cache);

export function bindings(cx: Ctx, f: CodeFile): Map<string, Bind> {
  let out = cx.ix.binds.get(f.path);
  if (!out) {
    out = new Map(importsOf(cx.root, f, cx.read).map((i) => [i.local, { mod: i.path, imported: i.name, dir: f.lang === 'go' }]));
    cx.ix.binds.set(f.path, out);
  }
  return out;
}

const SKIP = new Set(['target', 'bin', 'obj', 'build', 'dist']);

function repoFiles(cx: Ctx): string[] {
  return (cx.ix.repo ??= (cx.read.files ?? readFile.files!)(cx.root));
}

export function goDirFiles(cx: Ctx, dir: string): CodeFile[] {
  return repoFiles(cx)
    .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go') && posix.dirname(f) === dir)
    .map((f) => file(cx, f))
    .filter((f) => f != null);
}

const project = (g: Globals, path: string) => g.projects.find((p) => `/${path}`.startsWith(p === './' ? '/' : `/${p}`)) ?? '';

export function global(cx: Ctx, lang: 'java' | 'cs' | 'rs'): Globals {
  const hit = cx.ix.globals.get(lang);
  if (hit) return hit;
  const ext = { java: '.java', cs: '.cs', rs: '.rs' }[lang];
  const g: Globals = {
    types: new Map(),
    impls: new Map(),
    aliases: new Map(),
    usings: new Set(),
    projects: repoFiles(cx)
      .filter((f) => f.endsWith('.csproj'))
      .map((f) => `${posix.dirname(f)}/`)
      .sort((a, b) => b.length - a.length),
  };
  for (const rel of repoFiles(cx)) {
    if (!rel.endsWith(ext) || rel.split('/').some((s) => SKIP.has(s))) continue;
    const src = cx.read(resolve(cx.root, rel));
    if (src == null) continue;
    for (const m of src.matchAll(/\b(class|interface|record|struct|enum|trait)\s+([A-Za-z_]\w*)/g)) {
      const list = g.types.get(m[2]) ?? [];
      if (!list.includes(rel)) list.push(rel);
      g.types.set(m[2], list);
    }
    if (lang === 'cs') for (const m of src.matchAll(/^\s*global\s+using\s+([\w.]+)\s*;/gm)) g.usings.add(`${project(g, rel)}|${m[1]}`);
    if (lang !== 'rs') continue;
    for (const m of src.matchAll(/\btype\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*([^;]+);/g)) g.aliases.set(m[1], m[2]);
    for (const m of src.matchAll(/\bimpl\b\s*(?:<[^>]*>)?\s*([\w:]+)(?:<[^>]*>)?\s+for\s+(?:&\s*)?([\w:]+)/g)) {
      const ty = lastSeg(m[2]);
      g.impls.set(ty, (g.impls.get(ty) ?? new Set()).add(lastSeg(m[1])));
    }
  }
  cx.ix.globals.set(lang, g);
  return g;
}

const DECL = (lang: Lang, n: string) =>
  ({
    ts: new RegExp(`\\b(class|interface)\\s+${esc(n)}\\b`, 'g'),
    py: new RegExp(`(^|\\n)[ \\t]*class\\s+${esc(n)}\\b`, 'g'),
    go: new RegExp(`\\btype\\s+${esc(n)}(\\[[^\\]]*\\])?\\s+(struct\\b|interface\\b|[\\w.*[])`, 'g'),
    java: new RegExp(`\\b(class|interface|record|enum)\\s+${esc(n)}\\b`, 'g'),
    cs: new RegExp(`\\b(class|interface|record|struct)\\s+${esc(n)}\\b`, 'g'),
    rs: new RegExp(`\\b(struct|trait|enum)\\s+${esc(n)}\\b`, 'g'),
  })[lang];

export function declIn(info: CodeFile | null, name: string): Decl | null {
  if (!info) return null;
  const m = DECL(info.lang, name).exec(info.code);
  if (!m) return null;
  const start = m.index + (m[1] === '\n' ? 1 : 0);
  let end: number;
  if (info.lang === 'py') end = pyBody(info.code, start)[1];
  else if (info.lang === 'go' && !/(struct|interface)$/.test(m[0])) {
    const nl = info.code.indexOf('\n', m.index);
    end = nl < 0 ? info.code.length : nl;
  } else {
    const unit = info.lang === 'rs' && /struct/.test(m[0]) && /^[^{]*;/.test(info.code.slice(m.index, m.index + 200));
    const open = info.code.indexOf(unit ? ';' : '{', m.index);
    end = open < 0 ? info.code.length : info.code[open] === ';' ? open : matchClose(info.code, open) + 1;
  }
  return { info, start, end, name, kind: /interface|trait/.test(m[0]) ? 'interface' : 'class' };
}

export function findType(cx: Ctx, ctx: CodeFile, name: string | undefined, qual?: string | null): Decl | null {
  if (!name || name.startsWith('#')) return null;
  const key = `${ctx.path}|${qual ?? ''}|${name}`;
  if (cx.ix.types.has(key)) return cx.ix.types.get(key)!;
  cx.ix.types.set(key, null);
  const r = findType0(cx, ctx, name, qual);
  cx.ix.types.set(key, r);
  return r;
}

function findType0(cx: Ctx, ctx: CodeFile, name: string, qual?: string | null): Decl | null {
  const lang = ctx.lang;
  if (lang === 'go') {
    let dir = dirname(ctx.path);
    if (qual) {
      const b = bindings(cx, ctx).get(qual);
      if (!b?.mod) return null;
      dir = b.mod;
    }
    for (const f of goDirFiles(cx, dir)) {
      const d = declIn(f, name);
      if (d) return { ...d, dir };
    }
    return null;
  }
  if (!qual) {
    const d = declIn(ctx, name);
    if (d) return d;
  }
  if (lang === 'ts' || lang === 'py') {
    const b = bindings(cx, ctx).get(qual ? qual.split('.')[0] : name);
    if (!b?.mod) return null;
    return followExport(cx, b.mod, qual ? name : b.imported === 'default' || b.imported === '*' ? name : b.imported, lang, 0);
  }
  if (lang === 'java') {
    const outer = qual ? findType(cx, ctx, lastSeg(qual)) : null;
    if (outer) return declIn(outer.info, name);
    const imp = new RegExp(`^\\s*import\\s+([\\w.]+)\\.${esc(name)}\\s*;`, 'm').exec(ctx.keep);
    const g = global(cx, 'java').types.get(name) ?? [];
    const pick = imp
      ? g.find((p) => p.replace(/\.java$/, '').endsWith(`${imp[1].replace(/\./g, '/')}/${name}`))
      : (g.find((p) => dirname(p) === dirname(ctx.path)) ?? wild(g, ctx));
    return pick ? declIn(file(cx, pick), name) : null;
  }
  const all = (global(cx, lang).types.get(name) ?? []).map((p) => declIn(file(cx, p), name)).filter((d) => d != null);
  if (lang === 'rs') {
    if (all.length <= 1) return all[0] ?? null;
    const hits = all.filter((d) => rustUses(ctx, name, d.info.path));
    return hits.length === 1 ? hits[0] : null;
  }
  const ns = (f: CodeFile) => /\bnamespace\s+([\w.]+)/.exec(f.code)?.[1] ?? '';
  const usings = new Set([...ctx.code.matchAll(/^\s*using\s+([\w.]+)\s*;/gm)].map((m) => m[1]));
  const g = global(cx, 'cs');
  const tiers: ((n: string) => boolean)[] = [
    (n) => n === ns(ctx) || ns(ctx).startsWith(`${n}.`),
    (n) => usings.has(n),
    (n) => !n || g.usings.has(`${project(g, ctx.path)}|${n}`),
  ];
  for (const tier of tiers) {
    const hits = all.filter((d) => tier(ns(d.info)));
    if (hits.length) return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

function wild(g: string[], ctx: CodeFile): string | null {
  const pkgs = [...ctx.keep.matchAll(/^\s*import\s+([\w.]+)\.\*\s*;/gm)].map((m) => `/${m[1].replace(/\./g, '/')}`);
  const hits = g.filter((p) => pkgs.some((k) => `/${dirname(p)}`.endsWith(k)));
  return hits.length === 1 ? hits[0] : null;
}

function followExport(cx: Ctx, mod: string, name: string, lang: Lang, depth: number): Decl | null {
  const info = file(cx, mod);
  if (!info) return null;
  const d = declIn(info, name);
  if (d) return d;
  if (depth > 1) return null;
  const sub = bindings(cx, info).get(name);
  if (sub?.mod && sub.mod !== mod)
    return followExport(cx, sub.mod, sub.imported === 'default' || sub.imported === '*' ? name : sub.imported, lang, depth + 1);
  if (lang === 'ts')
    for (const m of info.keep.matchAll(/\bexport\s+(\*|\{[^}]*\})\s+from\s+(["'])([^"']+)\2/g)) {
      if (m[1] !== '*' && !new RegExp(`\\b${esc(name)}\\b`).test(m[1])) continue;
      const p = resolveTs(cx.root, mod, m[3], cx.read);
      const r = p && followExport(cx, p, name, lang, depth + 1);
      if (r) return r;
    }
  return null;
}

function basesOf(cx: Ctx, d: Decl): string[] {
  const { info, start, name } = d;
  const lang = info.lang;
  let head = info.code.slice(start, info.code.indexOf(lang === 'py' ? ':' : '{', start + name.length) + 1 || start + 300);
  const at = head.indexOf(name) + name.length;
  if (head[at] === '<') {
    let depth = 0;
    let j = at;
    for (; j < head.length; j++) {
      if (head[j] === '<') depth++;
      else if (head[j] === '>' && --depth === 0) break;
    }
    head = head.slice(0, at) + head.slice(j + 1);
  }
  const split = (s: string) =>
    s
      .replace(/<[^<>]*(<[^<>]*>[^<>]*)*>/g, '')
      .split(',')
      .map((x) => x.trim().split(/\s+/)[0])
      .filter(Boolean)
      .map(lastSeg);
  let out: string[] = [];
  if (lang === 'ts' || lang === 'java') {
    const e = /\bextends\s+([^{]*?)(\bimplements\b|\{|$)/.exec(head);
    if (e) out.push(...split(e[1]));
    const i = /\bimplements\s+([^{]*)/.exec(head);
    if (i) out.push(...split(i[1]));
  } else if (lang === 'py') {
    const m = new RegExp(`class\\s+${esc(name)}\\s*\\(([^)]*)\\)`).exec(head);
    if (m) out = split(m[1].replace(/\w+\s*=\s*[\w.]+/g, ''));
  } else if (lang === 'cs') {
    const h = head.replace(new RegExp(`^[\\s\\S]*?\\b${esc(name)}\\s*(<[^>]*>)?\\s*(\\([^)]*\\))?`), '');
    const m = /^\s*:\s*([^{]*?)(\bwhere\b|\{|$)/.exec(h);
    if (m) out = split(m[1].replace(/\([^)]*\)/g, ''));
  } else if (lang === 'go') {
    for (const m of info.code.slice(start, d.end).matchAll(/\n[ \t]*\*?([\w.]+)[ \t]*(?=\n)/g)) out.push(lastSeg(m[1]));
  } else if (lang === 'rs') out = [...(global(cx, 'rs').impls.get(name) ?? [])];
  return out.filter((x) => x && x !== name);
}

export function ancestors(cx: Ctx, d: Decl): { name: string; d: Decl | null }[] {
  const out: { name: string; d: Decl | null }[] = [];
  const seen = new Set([d.name]);
  const todo = [d];
  while (todo.length && out.length < 30) {
    const c = todo.shift()!;
    for (const b of basesOf(cx, c)) {
      if (seen.has(b)) continue;
      seen.add(b);
      const bd = c.info.lang === 'rs' ? null : findType(cx, c.info, b);
      out.push({ name: b, d: bd });
      if (bd) todo.push(bd);
    }
  }
  return out;
}

export function goMethods(cx: Ctx, d: Decl): Set<string> {
  const out = new Set<string>();
  for (const f of goDirFiles(cx, dirname(d.info.path)))
    for (const m of f.code.matchAll(new RegExp(`\\bfunc\\s*\\(\\s*\\w*\\s*\\*?\\s*${esc(d.name)}(\\[[^\\]]*\\])?\\s*\\)\\s*(\\w+)`, 'g')))
      out.add(m[2]);
  return out;
}

export const goIfaceMethods = (d: Decl): string[] =>
  [...d.info.code.slice(d.start, d.end).matchAll(/\n[ \t]*([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);

export function defines(cx: Ctx, d: Decl, n: string): boolean {
  if (d.info.lang === 'go')
    return (
      goMethods(cx, d).has(n) ||
      (d.kind === 'interface' && new RegExp(`\\n[ \\t]*${esc(n)}\\s*\\(`).test(d.info.code.slice(d.start, d.end)))
    );
  return locate(d.info, `${d.name}.${n}`) != null;
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
