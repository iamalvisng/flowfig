import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

export type Lang = 'ts' | 'py' | 'go' | 'java' | 'cs' | 'rs';
export type Read = (full: string) => string | null;
export type CodeFile = {
  path: string;
  lang: Lang;
  text: string;
  code: string;
  keep: string;
};

const LANGS: Record<string, Lang> = {
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'ts',
  '.jsx': 'ts',
  '.mjs': 'ts',
  '.cjs': 'ts',
  '.py': 'py',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'cs',
  '.rs': 'rs',
};

export const langOf = (path: string): Lang | null => LANGS[extname(path)] ?? null;

export const readFile: Read = (full) => {
  try {
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
};

const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const wordBefore = (s: string, end: number) => /(\w+)$/.exec(s.slice(Math.max(0, end - 12), end))?.[1] ?? '';

function mask(src: string, lang: Lang): { code: string; keep: string } {
  let code = '';
  let keep = '';
  const n = src.length;
  let i = 0;
  const push = (txt: string, kind: 'code' | 'string' | 'comment') => {
    code += kind === 'code' ? txt : blank(txt);
    keep += kind === 'comment' ? blank(txt) : txt;
  };
  if (lang === 'py') {
    while (i < n) {
      const c = src[i];
      if (c === '#') {
        const e = src.indexOf('\n', i);
        const end = e < 0 ? n : e;
        push(src.slice(i, end), 'comment');
        i = end;
        continue;
      }
      const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
      if (m && (m[1] === '' || !/[\w]/.test(src[i - 1] ?? ''))) {
        const q = m[2];
        let j = i + m[0].length;
        while (j < n) {
          if (src[j] === '\\') j += 2;
          else if (src.startsWith(q, j)) {
            j += q.length;
            break;
          } else if (q.length === 1 && src[j] === '\n') break;
          else j++;
        }
        const bodyAt = i + m[0].length;
        const closeAt = Math.max(bodyAt, j - q.length);
        push(src.slice(i, bodyAt), 'code');
        push(src.slice(bodyAt, closeAt), 'string');
        push(src.slice(closeAt, j), 'code');
        i = j;
        continue;
      }
      push(c, 'code');
      i++;
    }
    return { code, keep };
  }
  const stack: number[] = [];
  let depth = 0;
  let prevSig = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      push(src.slice(i, end), 'comment');
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      push(src.slice(i, end), 'comment');
      i = end;
      continue;
    }
    if (lang === 'ts' && c === '/' && /^$|[(,=:[!&|?{};]$/.test(prevSig)) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '/' && !cls) break;
        else {
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          j++;
        }
      }
      if (src[j] === '/') {
        push('/', 'code');
        push(src.slice(i + 1, j), 'string');
        push('/', 'code');
        i = j + 1;
        prevSig = 'x';
        continue;
      }
    }
    if (lang === 'rs' && c === "'" && /[A-Za-z_]/.test(d ?? '') && src[i + 2] !== "'") {
      push(c, 'code');
      i++;
      continue;
    }
    const tpl = lang === 'ts' && c === '`';
    const raw = (lang === 'go' && c === '`') || (lang === 'cs' && c === '@' && d === '"');
    if (c === '"' || c === "'" || tpl || raw || (c === '}' && stack.length && stack.at(-1) === depth)) {
      let open = c;
      if (c === '}') {
        stack.pop();
        depth--;
      }
      if (raw && c === '@') open = '"';
      const startQ = c === '@' ? i + 2 : i + 1;
      const q = c === '}' ? '`' : open;
      const triple = (lang === 'java' || lang === 'cs') && src.startsWith('"""', i);
      let j = triple ? i + 3 : startQ;
      let enterTpl = false;
      while (j < n) {
        if (triple) {
          if (src.startsWith('"""', j)) break;
          j++;
          continue;
        }
        if (src[j] === '\\' && !raw) j += 2;
        else if (raw && c === '@' && src[j] === '"' && src[j + 1] === '"') j += 2;
        else if (src[j] === q) break;
        else if (q === '`' && lang === 'ts' && src[j] === '$' && src[j + 1] === '{') {
          enterTpl = true;
          break;
        } else if (!raw && q !== '`' && src[j] === '\n') break;
        else j++;
      }
      const head = c === '}' ? 1 : startQ - i;
      push(src.slice(i, i + head), 'code');
      push(src.slice(i + head, j), 'string');
      if (enterTpl) {
        push('${', 'code');
        depth++;
        stack.push(depth);
        i = j + 2;
        prevSig = '{';
        continue;
      }
      const tail = triple ? 3 : 1;
      push(src.slice(j, j + tail), 'code');
      i = j + tail;
      prevSig = 'x';
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    push(c, 'code');
    if (!/\s/.test(c)) prevSig = /\w/.test(c) ? (/^(return|typeof|case|in|of)$/.test(wordBefore(src, i + 1)) ? '(' : 'x') : c;
    i++;
  }
  return { code, keep };
}

type Extent = [number, number];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchClose(code: string, open: number): number {
  const pair = { '{': '}', '(': ')', '[': ']' }[code[open] as '{' | '(' | '['];
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) d++;
    else if (code[i] === pair && --d === 0) return i;
  }
  return code.length - 1;
}

const indentAt = (code: string, pos: number) => {
  const ls = code.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(code.slice(ls))![0].length;
};

function braceBody(code: string, from: number, start: number, lang: Lang): Extent | null {
  let i = from;
  let pd = 0;
  const defIndent = indentAt(code, start);
  while (i < code.length) {
    const c = code[i];
    if (c === '(' || c === '[') pd++;
    else if (c === ')' || c === ']') {
      if (--pd < 0) return null;
    } else if (pd === 0) {
      if (c === ';') return [start, i + 1];
      if (c === '\n' && lang === 'go' && !/[,({[=+\-*/|&.:]\s*$/.test(code.slice(Math.max(start, i - 40), i))) return [start, i];
      if (c === '}') return null;
      if (c === '=' && code[i + 1] === '>' && lang === 'ts') {
        let k = i + 2;
        while (/\s/.test(code[k])) k++;
        if (code[k] !== '{') {
          let pd2 = 0;
          for (let j = k; j < code.length; j++) {
            const ch = code[j];
            if ('([{'.includes(ch)) pd2++;
            else if (')]}'.includes(ch)) {
              if (--pd2 < 0) return [start, j];
            } else if (pd2 === 0 && (ch === ';' || ch === ',')) return [start, j];
            else if (pd2 === 0 && ch === '\n') {
              const next = code.slice(j + 1).match(/^[ \t]*(\S)/);
              if (next && indentAt(code, j + 1) <= defIndent && !/[.?:|&+]/.test(next[1])) return [start, j];
            }
          }
          return [start, code.length];
        }
        i = k;
        continue;
      }
      if (c === '{') {
        const before = code.slice(Math.max(0, i - 12), i).trimEnd();
        const goTypeDecl = lang === 'go' && /^type\s+\w+(\[[^\]]*\])?\s+(struct|interface)\s*$/.test(code.slice(start, i));
        if (!goTypeDecl && (/[:|&<,]$/.test(before) || /\b(interface|struct)$/.test(before))) {
          i = matchClose(code, i) + 1;
          continue;
        }
        return [start, matchClose(code, i) + 1];
      }
    }
    i++;
  }
  return null;
}

function pyBody(code: string, start: number): Extent {
  const ind = indentAt(code, start);
  let i = start;
  let pd = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if ('([{'.includes(c)) pd++;
    else if (')]}'.includes(c)) pd--;
    else if (c === ':' && pd === 0 && /^[ \t]*(\n|$)/.test(code.slice(i + 1, i + 200))) break;
    else if (c === '\n' && pd === 0 && !code.slice(start, i).endsWith('\\')) {
      if (!/^\s*(async\s+)?(def|class)\b/.test(code.slice(code.lastIndexOf('\n', start - 1) + 1))) return [start, i];
    }
  }
  let j = code.indexOf('\n', i);
  if (j < 0) return [start, code.length];
  let end = j;
  while (j < code.length) {
    const ls = j + 1;
    const le = code.indexOf('\n', ls) < 0 ? code.length : code.indexOf('\n', ls);
    const line = code.slice(ls, le);
    if (line.trim() && indentAt(code, ls) <= ind) break;
    if (line.trim()) end = le;
    j = le;
    if (le >= code.length) break;
  }
  return [start, end];
}

const E = '(?![\\p{L}\\p{N}_$])';

function defPatterns(lang: Lang, name: string, inContainer: boolean): RegExp[] {
  const N = esc(name);
  const re = (src: string) => new RegExp(src, 'gu');
  switch (lang) {
    case 'ts':
      return [
        re(`\\bfunction\\s*\\*?\\s*${N}\\s*[<(]`),
        re(`\\b(class|interface|enum|namespace|module)\\s+${N}${E}`),
        re(`\\btype\\s+${N}${E}\\s*[<=]`),
        re(`\\b(const|let|var)\\s+${N}${E}\\s*[:=]`),
        re(`(^|[\\n;{}])[ \\t]*((public|private|protected|static|async|readonly|override|abstract|get|set|declare)\\s+)*\\*?${N}\\s*[<(]`),
        re(
          `(^|[\\n;{}])[ \\t]*((public|private|protected|static|readonly|override|declare)\\s+)*${N}\\s*[?!]?\\s*(:(?:[^=;\\n]|=>)*)?=(?![=>])`,
        ),
        re(`(^|[\\n;{}])[ \\t]*(module\\.)?exports\\.${N}\\s*=(?!=)`),
        ...(inContainer ? [re(`(^|[\\n{,])[ \\t]*${N}\\s*[?]?:`)] : []),
      ];
    case 'py':
      return [
        re(`(^|\\n)[ \\t]*(async\\s+)?def\\s+${N}\\s*\\(`),
        re(`(^|\\n)[ \\t]*class\\s+${N}${E}`),
        re(`(^|\\n)${inContainer ? '[ \\t]+' : ''}${N}\\s*(:[^=\\n]+)?=(?!=)`),
      ];
    case 'go':
      return [
        re(`\\bfunc\\s+${N}\\s*[\\[(]`),
        re(`\\bfunc\\s*\\([^)]*\\)\\s*${N}\\s*[\\[(]`),
        re(`\\btype\\s+${N}${E}`),
        re(`\\b(var|const)\\s+${N}${E}`),
        re(`(^|\\n)[ \\t]+${N}${E}(\\s*,\\s*[\\p{L}\\p{N}_]+)*\\s*(=|[\\w\\[*]+[^\\n]*=)`),
        re(`(^|\\n)[ \\t]+${N}\\s+(struct|interface)${E}`),
        ...(inContainer ? [re(`(^|\\n)[ \\t]+${N}\\s*(\\(|\\s+\\S)`)] : []),
      ];
    case 'java':
    case 'cs':
      return [
        re(`\\b(class|interface|enum|record|struct)\\s+${N}${E}`),
        re(`(^|[\\n;{}])[ \\t]*([\\w<>\\[\\],.?]+\\s+)+${N}\\s*(<[^>]*>)?\\s*\\(`),
        re(`(^|[\\n;{}\\]])[ \\t]*([\\w<>\\[\\],.?]+\\s+)+${N}\\s*(=(?![=>])|;|\\{\\s*(get|set|init)\\b|=>)`),
      ];
    case 'rs':
      return [re(`\\bfn\\s+${N}${E}`), re(`\\b(struct|enum|trait|type|mod|const|static|union)\\s+${N}${E}`)];
  }
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'await', 'typeof', 'else', 'do', 'throw']);

function depthAt(code: string, pos: number, lo: number): number {
  let d = 0;
  for (let i = lo; i < pos; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}') d--;
  }
  return d;
}

function inTypeBody(code: string, pos: number): boolean {
  for (let i = pos, d = 0; i >= 0; i--) {
    if (code[i] === '}') d++;
    else if (code[i] === '{' && d-- === 0)
      return /\b(class|interface|enum|record|struct)\b[^;{}]*$/.test(code.slice(Math.max(0, i - 300), i));
  }
  return false;
}

function pyMemberIndent(code: string, lo: number, hi: number): number {
  const base = indentAt(code, lo);
  let min = Infinity;
  for (const line of code.slice(lo, hi).split('\n').slice(1)) {
    const ind = /^[ \t]*/.exec(line)![0].length;
    if (line.trim() && ind > base) min = Math.min(min, ind);
  }
  return min;
}

function findIn(code: string, lang: Lang, name: string, lo: number, hi: number, member: number | null, receiver?: string): Extent | null {
  if (KEYWORDS.has(name) && !/^(rs|py|go)$/.test(lang)) return null;
  const inContainer = member != null;
  const memberIndent = inContainer && lang === 'py' ? pyMemberIndent(code, lo, hi) : -1;
  const hits: { start: number; end: number; depth: number }[] = [];
  const pats = defPatterns(lang, name, inContainer);
  for (const re of pats) {
    re.lastIndex = lo;
    let m;
    while ((m = re.exec(code)) && m.index < hi) {
      const nameAt = m.index + m[0].lastIndexOf(name);
      const start = m.index + (m[0].length - m[0].trimStart().length);
      if (lang === 'go' && receiver != null && !/^\s*func\s*\(/.test(m[0])) continue;
      if (lang === 'go' && receiver != null && /^func\s*\(/.test(m[0])) {
        const recv = /^func\s*\(([^)]*)\)/
          .exec(m[0])![1]
          .trim()
          .replace(/^\w+\s+/, '');
        if (!new RegExp(`^\\*?\\s*${esc(receiver)}(\\[[^\\]]*\\])?$`).test(recv)) continue;
      }
      if (code[nameAt - 1] === '.' && !/\bexports\.$/.test(code.slice(nameAt - 8, nameAt))) continue;
      if (lang === 'ts' && /[?:=&|]\s*$/.test(code.slice(0, start))) continue;
      if (lang === 'go' && !inContainer && m[0].includes('=') && depthAt(code, start, 0) > 0) continue;
      if ((lang === 'java' || lang === 'cs') && re === pats.at(-1) && !inTypeBody(code, start)) continue;
      const ext = lang === 'py' ? pyBody(code, start) : braceBody(code, nameAt + name.length, start, lang);
      if (!ext) continue;
      const isMethodish = /\(\s*$/.test(m[0]) && !/\b(function|func|fn|def)\b/.test(m[0]);
      if (isMethodish && lang !== 'py' && !(lang === 'go' && inContainer)) {
        const p = code.indexOf('(', nameAt);
        const close = matchClose(code, p);
        const after = code.slice(close + 1).match(/^\s*(\S)/)?.[1];
        if (
          !after ||
          !(
            after === '{' ||
            after === ':' ||
            (lang !== 'ts' && /[\w=]/.test(after)) ||
            (after === ';' && (lang === 'java' || lang === 'cs'))
          )
        )
          continue;
        if (lang === 'java' || lang === 'cs') {
          const pre = code.slice(start, nameAt);
          if (/\b(new|return|else|throw)\s*$/.test(pre) || /[=.]\s*$/.test(pre)) continue;
        }
      }
      if (lang === 'java' || lang === 'cs') {
        const pre = code.slice(start, nameAt);
        if (/\b(new|return|else|throw|await|yield|case|in|is|as|out|ref|goto|var|using|do)\s*$/.test(pre) || /[=.]\s*$/.test(pre)) continue;
      }
      const depth = depthAt(code, start, lo);
      if (inContainer && lang === 'py' ? indentAt(code, start) !== memberIndent : member != null && depth !== member) continue;
      hits.push({ start, end: ext[1], depth });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.depth - b.depth || a.start - b.start);
  return [hits[0].start, hits[0].end];
}

function rustImpls(code: string, type: string): Extent[] {
  const out: Extent[] = [];
  const self = new RegExp(`^(\\w+::)*${esc(type)}\\s*(<.*>)?$`, 's');
  const re = /\bimpl\b([^{;]*)\{/g;
  let m;
  while ((m = re.exec(code))) {
    let head = m[1].replace(/\bwhere\b[^]*$/, '').trim();
    if (head.startsWith('<')) {
      let d = 0;
      let k = 0;
      do {
        if (head[k] === '<') d++;
        else if (head[k] === '>' && head[k - 1] !== '-') d--;
      } while (d > 0 && ++k < head.length);
      head = head.slice(k + 1).trim();
    }
    const forAt = head.search(/\bfor\s/);
    if (!self.test(forAt < 0 ? head : head.slice(forAt + 3).trim())) continue;
    const open = m.index + m[0].length - 1;
    out.push([open, matchClose(code, open)]);
  }
  return out;
}

export function codeFile(root: string, path: string, read: Read = readFile, cache = new Map<string, CodeFile | null>()): CodeFile | null {
  const full = resolve(root, path);
  if (cache.has(full)) return cache.get(full)!;
  const lang = langOf(path);
  const raw = lang ? read(full) : null;
  const text = raw?.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const file = lang && text != null ? { path, lang, text, ...mask(text, lang) } : null;
  cache.set(full, file);
  return file;
}

export function locate(file: CodeFile, symbol: string): { start: number; end: number } | null {
  const { code, lang } = file;
  const parts = symbol.split('.');
  if (!parts.every((p) => /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(p))) return null;
  const hit = (r: Extent | null) => {
    if (!r) return null;
    let start = r[0];
    for (;;) {
      const prevEnd = code.lastIndexOf('\n', start - 1);
      if (prevEnd < 0) break;
      const prevStart = code.lastIndexOf('\n', prevEnd - 1) + 1;
      if (!/^\s*@/.test(code.slice(prevStart, prevEnd))) break;
      start = prevStart;
    }
    return { start, end: r[1] };
  };
  if (parts.length === 1 && parts[0] === 'default' && lang === 'ts') {
    const m = /\bexport\s+default\b/.exec(code);
    return m && { start: m.index, end: code.length };
  }
  if (parts.length === 1) return hit(findIn(code, lang, parts[0], 0, code.length, null));
  if (lang === 'go' && parts.length === 2) {
    const r = findIn(code, lang, parts[1], 0, code.length, null, parts[0]);
    if (r && /^func\s*\(/.test(code.slice(r[0]))) return hit(r);
    const t = findIn(code, lang, parts[0], 0, code.length, null);
    return t ? hit(findIn(code, lang, parts[1], t[0] + 1, t[1], 1)) : null;
  }
  if (lang === 'rs' && parts.length === 2) {
    for (const [a, b] of rustImpls(code, parts[0])) {
      const r = findIn(code, lang, parts[1], a + 1, b, 0);
      if (r) return hit(r);
    }
    return null;
  }
  let lo = 0;
  let hi = code.length;
  for (let k = 0; k < parts.length; k++) {
    const r = findIn(code, lang, parts[k], lo, hi, k > 0 ? 1 : null);
    if (!r) return null;
    if (k === parts.length - 1) return hit(r);
    lo = r[0] + 1;
    hi = r[1];
  }
  return null;
}

export const isDefined = (file: CodeFile, symbol: string): boolean => locate(file, symbol) != null;
