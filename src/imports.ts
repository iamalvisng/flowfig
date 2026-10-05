import { builtinModules } from 'node:module';
import { posix, resolve } from 'node:path';
import { codeFile, esc, langOf, outside, readFile, type CodeFile, type Read } from './code.ts';

export type Import = { name: string; local: string; path: string | null };

export const OUTSIDE = '#outside';

const TS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];
const readIn = (root: string, path: string, read: Read) => (outside(root, path) ? null : read(resolve(root, path)));
const has = (root: string, path: string, read: Read) => readIn(root, path, read) != null;

function tsConfig(root: string, read: Read) {
  const paths: { base: string; key: string; target: string }[] = [];
  let baseUrl: string | undefined;
  let cfg = 'tsconfig.json';
  for (let k = 0; k < 4 && cfg; k++) {
    const raw = readIn(root, cfg, read);
    if (raw == null) break;
    const dir = posix.dirname(cfg);
    const own = /"baseUrl"\s*:\s*"([^"]*)"/.exec(raw)?.[1];
    if (own != null) baseUrl ??= posix.join(dir, own);
    const block = /"paths"\s*:\s*\{([^}]*)\}/.exec(raw)?.[1] ?? '';
    for (const m of block.matchAll(/"([^"]+)"\s*:\s*\[\s*"([^"]+)"/g))
      paths.push({ base: own != null ? posix.join(dir, own) : dir, key: m[1], target: m[2] });
    const ext = /"extends"\s*:\s*"(\.[^"]+)"/.exec(raw)?.[1];
    cfg = ext ? posix.join(dir, ext.endsWith('.json') ? ext : `${ext}.json`) : '';
  }
  return { paths, baseUrl };
}

export function resolveTs(root: string, from: string, spec: string, read: Read): string | null {
  const bases: string[] = [];
  if (spec.startsWith('.')) bases.push(posix.join(posix.dirname(from), spec));
  else {
    const cfg = tsConfig(root, read);
    for (const { base, key, target } of cfg.paths) {
      const star = key.indexOf('*');
      const pre = star < 0 ? key : key.slice(0, star);
      const post = star < 0 ? '' : key.slice(star + 1);
      if (star < 0 ? spec !== key : !(spec.startsWith(pre) && spec.endsWith(post) && spec.length >= key.length - 1)) continue;
      bases.push(posix.join(base, star < 0 ? target : target.replace('*', spec.slice(pre.length, spec.length - post.length))));
    }
    if (cfg.baseUrl != null) bases.push(posix.join(cfg.baseUrl, spec));
  }
  for (const b of bases) {
    const base = b.replace(/\.(js|mjs|cjs|jsx)$/, '');
    const hit = TS_EXT.map((e) => base + e).find((p) => has(root, p, read));
    if (hit) return hit;
  }
  return spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]) ? OUTSIDE : null;
}

function pyTop(root: string, from: string, read: Read): string {
  let d = posix.dirname(from);
  while (d !== '.' && has(root, `${d}/__init__.py`, read)) d = posix.dirname(d);
  return d;
}

export function resolvePy(root: string, from: string, mod: string, read: Read, top?: string): string | null {
  const hit = (b: string) => [`${b}.py`, `${b}/__init__.py`].find((p) => has(root, p, read)) ?? null;
  if (mod.startsWith('.')) {
    const dots = /^\.+/.exec(mod)![0].length;
    let d = posix.dirname(from);
    for (let k = 1; k < dots; k++) {
      if (d === '.') return null;
      d = posix.dirname(d);
    }
    return hit(posix.join(d, mod.slice(dots).replace(/\./g, '/')));
  }
  const rel = mod.replace(/\./g, '/');
  const d = top ?? pyTop(root, from, read);
  return hit(rel) ?? (d === '.' ? null : hit(posix.join(d, rel)));
}

function goModule(root: string, from: string, read: Read): { mod?: string; dir: string; text: string } {
  let dir = posix.dirname(from);
  for (;;) {
    const text = readIn(root, posix.join(dir, 'go.mod'), read);
    if (text != null) return { mod: /module\s+(\S+)/.exec(text)?.[1], dir, text };
    if (dir === '.') return { dir, text: '' };
    dir = posix.dirname(dir);
  }
}

function goWork(root: string, from: string, read: Read): { mod: string; dir: string }[] {
  for (let d = posix.dirname(from); ; d = posix.dirname(d)) {
    const text = readIn(root, posix.join(d, 'go.work'), read);
    if (text != null)
      return [...text.matchAll(/^\s*(?:use\s+)?"?(\.[^\s")]*)"?\s*$/gm)].flatMap((m) => {
        const dir = posix.join(d, m[1]);
        const mod = /module\s+(\S+)/.exec(readIn(root, posix.join(dir, 'go.mod'), read) ?? '')?.[1];
        return mod ? [{ mod, dir }] : [];
      });
    if (d === '.') return [];
  }
}

const goRequired = (text: string, p: string) =>
  [...text.matchAll(/^\s*(?:require\s+)?([\w.~-]+\/[\w.~/-]+)\s+v\S+/gm)].some(
    (m) => (p === m[1] || p.startsWith(`${m[1]}/`)) && !new RegExp(`^\\s*(?:replace\\s+)?${esc(m[1])}\\b[^\\n]*=>`, 'm').test(text),
  );

export function importsOf(root: string, file: CodeFile, read: Read): Import[] {
  const { keep, lang, path } = file;
  const out: Import[] = [];
  const add = (name: string, local: string, to: string | null) => out.push({ name, local, path: to });
  if (lang === 'ts') {
    for (const m of keep.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+(["'])([^"']+)\3/g)) {
      const to = resolveTs(root, path, m[4], read);
      const clause = m[2];
      const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause);
      if (def) add('default', def[1], to);
      const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (ns) add('*', ns[1], to);
      const named = /\{([\s\S]*)\}/.exec(clause);
      if (named)
        for (const part of named[1].split(',')) {
          const p = part.trim().replace(/^type\s+/, '');
          if (!p) continue;
          const [a, b] = p.split(/\s+as\s+/);
          add(a.trim(), (b ?? a).trim(), to);
        }
    }
    for (const m of keep.matchAll(
      /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\((["'])([^"']+)\2\)/g,
    )) {
      const to = resolveTs(root, path, m[3], read);
      if (m[1].startsWith('{'))
        for (const p of m[1].slice(1, -1).split(',')) {
          const [a, b] = p.split(':').map((x) => x.trim());
          if (a) add(a, b ?? a, to);
        }
      else add('*', m[1], to);
    }
  } else if (lang === 'py') {
    const top = pyTop(root, path, read);
    for (const m of keep.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
      const to = resolvePy(root, path, m[1], read, top);
      for (const part of m[2].replace(/[()]/g, '').split(',')) {
        const p = part.trim();
        if (!p) continue;
        const [a, b] = p.split(/\s+as\s+/).map((x) => x.trim());
        const sub = resolvePy(root, path, (m[1].endsWith('.') ? m[1] : `${m[1]}.`) + a, read, top);
        if (sub) add('*', b ?? a, sub);
        else add(a, b ?? a, to);
      }
    }
    for (const m of keep.matchAll(/^[ \t]*import\s+([\w.]+)(\s+as\s+(\w+))?/gm))
      add('*', m[3] ?? m[1].split('.')[0], resolvePy(root, path, m[1], read, top));
  } else if (lang === 'go') {
    const { mod, dir, text } = goModule(root, path, read);
    let work: { mod: string; dir: string }[] | undefined;
    for (const m of keep.matchAll(/^\s*(?:import\s+)?(\w+|\.|_)?\s*"([^"]+)"/gm)) {
      const p = m[2];
      const inside = (w: { mod?: string; dir: string }) => w.mod && (p === w.mod || p.startsWith(`${w.mod}/`));
      const own = [
        { mod, dir },
        ...(p.split('/')[0].includes('.') && !inside({ mod, dir }) ? (work ??= goWork(root, path, read)) : []),
      ].find(inside);
      const to = own
        ? posix.join(own.dir, p.slice(own.mod!.length + 1))
        : p.split('/')[0].includes('.') && !goRequired(text, p)
          ? null
          : OUTSIDE;
      add('*', m[1] ?? p.split('/').at(-1)!, to);
    }
  }
  return out;
}

function reexports(root: string, file: CodeFile, name: string, read: Read): [string | null, string][] {
  const N = esc(name);
  const out: [string | null, string][] = [];
  if (name === '*') return out;
  if (file.lang === 'py') {
    if (new RegExp(`^(?:(?:async\\s+)?def|class)\\s+${N}\\b|^${N}\\s*[:=]`, 'm').test(file.code)) return out;
    for (const i of importsOf(root, file, read))
      if (i.local === name || i.local === '*') out.push([i.path, i.local === '*' ? '?' : i.name]);
    return out.length > 1 ? [[null, '?']] : out;
  }
  if (file.lang !== 'ts') return out;
  if (new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var|enum)\\s*${N}\\b`, 'm').test(file.code))
    return out;
  for (const m of file.keep.matchAll(/\bexport\s+(?:type\s+)?(\*(?:\s+as\s+([\w$]+))?|\{([^}]*)\})\s+from\s+(["'])([^"']+)\4/g)) {
    const p = resolveTs(root, file.path, m[5], read);
    if (m[3] != null) {
      for (const part of m[3].split(',')) {
        const [a, b] = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/);
        if (a && (b ?? a).trim() === name) out.push([p, a.trim()]);
      }
    } else if (m[2] == null ? name !== 'default' : m[2] === name) out.push([p, m[2] == null ? name : '*']);
  }
  for (const m of file.keep.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from)/g))
    for (const part of m[1].split(',')) {
      const [a, b] = part.trim().split(/\s+as\s+/);
      if (!a || (b ?? a).trim() !== name) continue;
      const i = importsOf(root, file, read).find((x) => x.local === a.trim());
      if (i) out.push([i.path, i.name]);
    }
  return out;
}

export function leadsTo(
  root: string,
  fromPath: string,
  toPath: string,
  name: string,
  read: Read = readFile,
  cache = new Map<string, CodeFile | null>(),
  depth = 0,
): string | null {
  if (fromPath === toPath) return name;
  if (langOf(fromPath) == null) return posix.dirname(toPath) === fromPath ? name : null;
  const file = depth < 5 ? codeFile(root, fromPath, read, cache) : null;
  if (!file) return null;
  let star = false;
  for (const [path, inner] of reexports(root, file, name, read)) {
    const r = path == null || inner === '?' ? null : leadsTo(root, path, toPath, inner, read, cache, depth + 1);
    if (r === '?' || inner === '?') star = true;
    else if (r != null) return r;
  }
  return star ? '?' : null;
}
