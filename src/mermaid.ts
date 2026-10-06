import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FigEdge, FigGroup, FigHop, FigNode, FlowProps } from './model.ts';

export type MermaidFault = { line: number; reason: string };
type Result = { spec: FlowProps; faults: [] } | { spec?: undefined; faults: MermaidFault[] };

const IGNORED = /^(%%|classDef\s|class\s|style\s|linkStyle\s|click\s|direction\s)/;
const ID = /[\p{L}\p{N}_]+/uy;
const SHAPES: [string, string, FigNode['shape']][] = [
  ['([', '])', 'box'],
  ['[(', ')]', 'store'],
  ['((', '))', 'box'],
  ['[', ']', 'box'],
  ['(', ')', 'box'],
  ['{', '}', 'decision'],
];
const ARROW = /(?:--+>|---+|-\.+->|-\.+-|==+>|===+)/y;
const LABELED_ARROW = /(--|==|-\.)\s+(.+?)\s+(?:--+>|---+|==+>|===+|\.-+>|\.-+)/y;
const PIPE_LABEL = /\s*\|"?([^|"]*)"?\|/y;
const CLASS = /:::[\w-]+/y;

const clean = (text: string) =>
  text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function sticky(re: RegExp, s: string, at: number) {
  re.lastIndex = at;
  return re.exec(s);
}

/** One Mermaid diagram to a flowfig spec, or the lines it cannot read. `first` is the line number of the first line. */
export function fromMermaid(text: string, first = 1): Result {
  const lines = text.split(/\r?\n/).map((raw, i) => ({ s: raw.trim(), n: first + i }));
  const body = lines.filter(({ s }) => s && !IGNORED.test(s));
  const head = body.shift();
  if (!head) return { faults: [{ line: first, reason: 'the diagram is empty' }] };
  const flow = /^(?:flowchart|graph)(?:\s+(TD|TB|LR|RL|BT))?\s*;?$/.exec(head.s);
  if (flow) return flowchart(body, flow[1] === 'LR' || flow[1] === 'RL' ? 'row' : 'column');
  if (head.s === 'sequenceDiagram') return sequence(body);
  return { faults: [{ line: head.n, reason: `"${head.s}" is not a flowchart, graph or sequenceDiagram` }] };
}

function flowchart(body: { s: string; n: number }[], direction: 'row' | 'column'): Result {
  const faults: MermaidFault[] = [];
  const nodes = new Map<string, FigNode & { order: number; parent?: FigGroup }>();
  const groups: (FigGroup & { order: number; parent?: FigGroup; mentions: string[] })[] = [];
  const open: (typeof groups)[number][] = [];
  const edges: FigEdge[] = [];
  let order = 0;

  const node = (s: string, at: number): [string, number] | string => {
    const id = sticky(ID, s, at)?.[0];
    if (!id) return at < s.length ? `expected a node id at "${s.slice(at)}"` : 'the link has no target';
    at += id.length;
    const found = nodes.get(id) ?? { id, label: id, order: order++ };
    nodes.set(id, found);
    for (const g of open) g.mentions.push(id);
    for (const [start, end, shape] of SHAPES) {
      if (!s.startsWith(start, at)) continue;
      let from = at + start.length;
      let label: string | undefined;
      if (s[from] === '"') {
        const close = s.indexOf('"', from + 1);
        if (close !== -1 && s.startsWith(end, close + 1)) [label, from] = [s.slice(from + 1, close), close + 1];
      } else {
        const close = s.indexOf(end, from);
        const inner = close === -1 ? '' : s.slice(from, close);
        if (close !== -1 && !/[[\](){}"]|^[/\\]/.test(inner)) [label, from] = [inner, close];
      }
      if (label === undefined || !s.startsWith(end, from)) continue;
      Object.assign(found, { label: clean(label) || id }, shape === 'box' ? {} : { shape });
      at = from + end.length;
      break;
    }
    if ('[({>'.includes(s[at] ?? ' ')) return `unsupported node shape at "${s.slice(at)}"`;
    if (sticky(CLASS, s, at)) at = CLASS.lastIndex;
    return [id, at];
  };

  for (const { s: raw, n } of body) {
    const s = raw.replace(/;$/, '');
    const sub = /^subgraph\s+([\p{L}\p{N}_]+)\s*\[\s*"?([^"\]]*)"?\s*\]$|^subgraph\s+(.+)$/u.exec(s);
    if (sub) {
      const label = clean(sub[2] ?? sub[3].replace(/^"|"$/g, ''));
      const id = sub[1] ?? (/^[\p{L}\p{N}_]+$/u.test(label) ? label : undefined);
      const g = { ...(id ? { id } : {}), label, children: [], order: order++, parent: open.at(-1), mentions: [] };
      groups.push(g);
      open.push(g);
      continue;
    }
    if (s === 'end') {
      const g = open.pop();
      if (!g) faults.push({ line: n, reason: '"end" has no subgraph' });
      else for (const id of g.mentions) if (!nodes.get(id)!.parent) nodes.get(id)!.parent = g;
      continue;
    }
    const chain: string[][] = [];
    const labels: (string | undefined)[] = [];
    let at = 0;
    let fault: string | undefined;
    for (;;) {
      const side: string[] = [];
      for (;;) {
        const got = node(s, at);
        if (typeof got === 'string') {
          fault = got;
          break;
        }
        side.push(got[0]);
        at = got[1];
        const amp = /\s*&\s*/y;
        if (!sticky(amp, s, at)) break;
        at = amp.lastIndex;
      }
      if (fault) break;
      chain.push(side);
      while (s[at] === ' ') at++;
      if (at >= s.length) break;
      const labeled = sticky(LABELED_ARROW, s, at);
      if (labeled) {
        labels.push(clean(labeled[2]).replace(/^"|"$/g, ''));
        at = LABELED_ARROW.lastIndex;
      } else if (sticky(ARROW, s, at)) {
        at = ARROW.lastIndex;
        const pipe = sticky(PIPE_LABEL, s, at);
        labels.push(pipe ? clean(pipe[1]) : undefined);
        if (pipe) at = PIPE_LABEL.lastIndex;
      } else {
        fault = `unsupported text at "${s.slice(at)}"`;
        break;
      }
      while (s[at] === ' ') at++;
    }
    if (fault) {
      faults.push({ line: n, reason: fault });
      continue;
    }
    labels.forEach((label, i) => {
      for (const from of chain[i])
        for (const to of chain[i + 1]) {
          const id = `${from}->${to}`;
          const count = edges.filter((e) => `${e.from}->${e.to}` === id).length;
          edges.push({ from, to, ...(label ? { label } : {}), ...(count ? { id: `${id}#${count + 1}` } : {}) });
        }
    });
  }
  if (open.length) faults.push({ line: body.at(-1)?.n ?? 1, reason: `subgraph "${open.at(-1)!.label}" has no "end"` });
  if (faults.length) return { faults };

  const groupIds = new Set(groups.map((g) => g.id));
  const items = [...groups, ...[...nodes.values()].filter((v) => !groupIds.has(v.id))].sort((a, b) => a.order - b.order);
  const children = (parent?: FigGroup): FigGroup['children'] =>
    items
      .filter((i) => i.parent === parent)
      .map(({ order: _o, parent: _p, ...rest }) => rest)
      .map((i) => ('mentions' in i ? (({ mentions: _m, ...g }) => g)(i) : i));
  for (const g of [...groups].reverse()) g.children = children(g);
  return { spec: { layout: { auto: true, direction, children: children() }, edges }, faults: [] };
}

function sequence(body: { s: string; n: number }[]): Result {
  const faults: MermaidFault[] = [];
  const people = new Map<string, FigNode>();
  const edges: FigEdge[] = [];
  const flow: FigHop[] = [];
  const meet = (id: string, label = id) => {
    if (!people.has(id) || label !== id) people.set(id, { id, label: clean(label).replace(/^"|"$/g, '') });
  };
  for (const { s, n } of body) {
    if (/^(activate|deactivate|note|autonumber|loop|alt|else|opt|par|and|rect|end)\b/i.test(s)) continue;
    const who = /^(?:participant|actor)\s+([\w.]+)(?:\s+as\s+(.+))?$/.exec(s);
    if (who) {
      meet(who[1], who[2]);
      continue;
    }
    const msg = /^([\w.]+)\s*(-->>|->>|-->|->|--\)|-\))\s*[+-]?([\w.]+)\s*(?::\s*(.*))?$/.exec(s);
    if (!msg) {
      faults.push({ line: n, reason: `unsupported line "${s}"` });
      continue;
    }
    const [, from, arrow, to, text] = msg;
    if (from === to) {
      faults.push({ line: n, reason: `a message from "${from}" to itself has no edge` });
      continue;
    }
    if (!people.has(from)) meet(from);
    if (!people.has(to)) meet(to);
    let edge = edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
    if (!edge) edges.push((edge = { from, to }));
    const data = clean(text ?? '');
    flow.push({
      edge: `${edge.from}->${edge.to}`,
      ...(edge.from === to ? { back: true } : {}),
      ...(arrow.endsWith(')') ? { async: true } : {}),
      ...(data ? { data } : {}),
    });
  }
  if (faults.length) return { faults };
  if (!flow.length) return { faults: [{ line: body[0]?.n ?? 1, reason: 'the sequence has no message' }] };
  return {
    spec: {
      layout: { auto: true, children: [...people.values()] },
      edges,
      steps: [{ label: 'Messages', flow }],
      rail: 'only',
    },
    faults: [],
  };
}

/** The Mermaid blocks of a Markdown text, each with the line number of its first line. */
export function markdownBlocks(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/.exec(lines[i]);
    if (!fence) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]));
    const stop = end === -1 ? lines.length : end;
    out.push({ text: lines.slice(i + 1, stop).join('\n'), line: i + 2 });
    i = stop;
  }
  return out;
}

const USAGE = 'usage: flowfig from-mermaid <file.mmd|file.md|-> [--out <dir>]';

export function runFromMermaid(argv: string[]): number {
  const fail = (message: string, code: number) => (console.error(message), code);
  const args = [...argv];
  let out: string | undefined;
  const at = args.indexOf('--out');
  if (at !== -1) {
    out = args.splice(at, 2)[1];
    if (!out || out.startsWith('-')) return fail('--out needs a folder', 2);
  }
  const bad = args.find((a) => a.startsWith('-') && a !== '-');
  if (bad) return fail(`unknown flag ${bad}`, 2);
  if (args.length !== 1) return fail(USAGE, 2);
  const [file] = args;
  let text: string;
  try {
    text = readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (e) {
    return fail(`${file}: ${(e as Error).message}`, 2);
  }
  const markdown = /\.(md|markdown|mdx)$/i.test(file);
  const blocks = markdown ? markdownBlocks(text) : [{ text, line: 1 }];
  if (!blocks.length) return fail(`${file}: no mermaid block`, 1);
  if (blocks.length > 1 && !out) return fail(`${file} has ${blocks.length} diagrams; use --out <dir>`, 2);
  const name = file === '-' ? 'stdin' : basename(file).replace(/\.[^.]+$/, '');
  let code = 0;
  blocks.forEach((b, i) => {
    const r = fromMermaid(b.text, b.line);
    if (!r.spec) {
      code = 1;
      for (const f of r.faults) console.error(`${file === '-' ? '<stdin>' : file}:${f.line}: ${f.reason}`);
      return;
    }
    const json = JSON.stringify(r.spec, null, 2) + '\n';
    if (!out) return void process.stdout.write(json);
    mkdirSync(out, { recursive: true });
    const path = join(out, markdown ? `${name}-${i + 1}.json` : `${name}.json`);
    writeFileSync(path, json);
    console.log(path);
  });
  return code;
}
