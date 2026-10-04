import { posix, resolve } from 'node:path';
import { codeFile, langOf, readFile, type CodeFile, type Read } from './code.ts';

export type Import = { name: string; local: string; path: string | null };

const TS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];
const has = (root: string, path: string, read: Read) => read(resolve(root, path)) != null;

export function resolveTs(root: string, from: string, spec: string, read: Read): string | null {
  let base: string;
  if (spec.startsWith('.')) base = posix.join(posix.dirname(from), spec);
  else {
    const raw = read(resolve(root, 'tsconfig.json')) ?? '';
    const baseUrl = /"baseUrl"\s*:\s*"([^"]*)"/.exec(raw)?.[1];
    const paths = [...raw.matchAll(/"([^"]+)\/\*"\s*:\s*\[\s*"([^"]+)\/\*"/g)];
    const hit = paths.find((m) => spec.startsWith(`${m[1]}/`));
    if (hit) base = posix.join(baseUrl ?? '.', hit[2], spec.slice(hit[1].length + 1));
    else if (baseUrl != null) base = posix.join(baseUrl, spec);
    else return null;
  }
  base = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
  return TS_EXT.map((e) => base + e).find((p) => has(root, p, read)) ?? null;
}

export function resolvePy(root: string, from: string, mod: string, read: Read): string | null {
  let base: string;
  if (mod.startsWith('.')) {
    const dots = /^\.+/.exec(mod)![0].length;
    let d = posix.dirname(from);
    for (let k = 1; k < dots; k++) d = posix.dirname(d);
    base = posix.join(d, mod.slice(dots).replace(/\./g, '/'));
  } else base = mod.replace(/\./g, '/');
  return [`${base}.py`, `${base}/__init__.py`].find((p) => has(root, p, read)) ?? null;
}

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
    for (const m of keep.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\((["'])([^"']+)\2\)/g)) {
      const to = resolveTs(root, path, m[3], read);
      if (m[1].startsWith('{'))
        for (const p of m[1].slice(1, -1).split(',')) {
          const [a, b] = p.split(':').map((x) => x.trim());
          if (a) add(a, b ?? a, to);
        }
      else add('*', m[1], to);
    }
  } else if (lang === 'py') {
    for (const m of keep.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
      const to = resolvePy(root, path, m[1], read);
      for (const part of m[2].replace(/[()]/g, '').split(',')) {
        const p = part.trim();
        if (!p) continue;
        const [a, b] = p.split(/\s+as\s+/).map((x) => x.trim());
        const sub = resolvePy(root, path, (m[1].endsWith('.') ? m[1] : `${m[1]}.`) + a, read);
        if (sub) add('*', b ?? a, sub);
        else add(a, b ?? a, to);
      }
    }
    for (const m of keep.matchAll(/^[ \t]*import\s+([\w.]+)(\s+as\s+(\w+))?/gm))
      add('*', m[3] ?? m[1].split('.')[0], resolvePy(root, path, m[1], read));
  } else if (lang === 'go') {
    const mod = /module\s+(\S+)/.exec(read(resolve(root, 'go.mod')) ?? '')?.[1];
    for (const m of keep.matchAll(/^\s*(?:import\s+)?(\w+|\.|_)?\s*"([^"]+)"/gm)) {
      const dir = mod && m[2].startsWith(`${mod}/`) ? m[2].slice(mod.length + 1) : null;
      add('*', m[1] ?? m[2].split('/').at(-1)!, dir);
    }
  }
  return out;
}

/** A Go import resolves to a folder, which leads to every file in it. */
export function leadsTo(
  root: string,
  fromPath: string,
  toPath: string,
  read: Read = readFile,
  cache = new Map<string, CodeFile | null>(),
): boolean {
  if (fromPath === toPath) return true;
  if (langOf(fromPath) == null) return posix.dirname(toPath) === fromPath;
  const file = codeFile(root, fromPath, read, cache);
  if (!file) return false;
  const next = importsOf(root, file, read).map((i) => i.path);
  if (file.lang === 'ts')
    for (const m of file.keep.matchAll(/\bexport\s+(?:\*|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+(["'])([^"']+)\1/g))
      next.push(resolveTs(root, fromPath, m[2], read));
  return next.includes(toPath);
}
