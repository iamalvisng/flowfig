import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { diff, formatDiff } from './diff.ts';
import { GUIDE, TOPICS } from './guide.ts';
import { loadSpec, reportLines, sortFindings, summaryLines, svgWithSpec, verifyLines } from './load.ts';
import { check, render } from './svg.ts';
import { checkRendered } from './check.ts';
import { coverageLine, unsureLines, verifyReport } from './verify.ts';
import { VERSION } from './version.ts';

export type Response = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };
type Result = { content: { type: 'text'; text: string }[]; isError?: true };

const specSchema = {
  description: 'The figure: the props object, { props }, or a path to a .json file or an SVG that flowfig wrote.',
  anyOf: [{ type: 'object' }, { type: 'string' }],
};
const checkProps = {
  spec: specSchema,
  strict: { type: 'boolean', description: 'Warnings count as errors.' },
  width: { type: 'number', description: 'The page width in px the reader sees. Default 830.' },
  minText: { type: 'number', description: 'The smallest text in px at that width. Default 10.' },
};
export const TOOLS = [
  {
    name: 'docs',
    description: 'The flowfig guide. Read it before the first render. A topic gives the detail for one kind of figure.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: Object.keys(TOPICS) } } },
  },
  {
    name: 'check',
    description:
      'List the faults of a figure: unknown ids, text overflow, crossings, label overlap, small text, low contrast. Fix every error before render.',
    inputSchema: { type: 'object', properties: checkProps, required: ['spec'] },
  },
  {
    name: 'render',
    description:
      'Check a figure, then write it as one animated SVG file. Returns the check lines and the path. On an error, writes nothing.',
    inputSchema: {
      type: 'object',
      properties: { ...checkProps, out: { type: 'string', description: 'The SVG path to write.' } },
      required: ['spec', 'out'],
    },
  },
  {
    name: 'verify',
    description: 'Check the code links (source) of one or more figures: the file and the symbol must exist under root.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Paths to .json files or SVGs.' },
        root: { type: 'string', description: 'The folder the links resolve against. Default: the working directory.' },
        strict: { type: 'boolean' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'diff',
    description: 'The spec changes between two figures, as a Markdown list.',
    inputSchema: { type: 'object', properties: { old: specSchema, new: specSchema }, required: ['old', 'new'] },
  },
];

class Bad extends Error {}
class Fault extends Error {}

const ok = (text: string, isError = false): Result =>
  isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
const spec = (v: unknown, name: string) => {
  if (typeof v !== 'string' && (typeof v !== 'object' || v === null)) throw new Bad(`${name}: spec must be an object or a path`);
  try {
    return loadSpec(v);
  } catch (e) {
    throw typeof v === 'string' ? new Fault((e as Error).message) : new Bad(`${name}: ${(e as Error).message}`);
  }
};
const need = (args: Record<string, unknown>, tool: string, keys: string[]) => {
  for (const k of keys) if (args[k] == null) throw new Bad(`${tool}: ${k} is required`);
};
const types = (args: Record<string, unknown>, tool: string, want: Record<string, 'number' | 'string' | 'boolean'>) => {
  for (const [k, t] of Object.entries(want)) {
    const v = args[k];
    if (v == null) continue;
    if (typeof v !== t || (t === 'number' && !((v as number) > 0 && Number.isFinite(v)))) {
      throw new Bad(`${tool}: ${k} must be ${t === 'number' ? 'a positive number' : `a ${t}`}`);
    }
  }
};

function run(name: string, args: Record<string, unknown>): Result {
  if (name === 'docs') {
    const topic = args.topic;
    if (topic == null) return ok(GUIDE);
    if (typeof topic !== 'string' || !Object.hasOwn(TOPICS, topic))
      throw new Bad(`docs: topic must be one of ${Object.keys(TOPICS).join(', ')}`);
    return ok(TOPICS[topic as keyof typeof TOPICS]);
  }
  if (name === 'check' || name === 'render') {
    need(args, name, name === 'render' ? ['spec', 'out'] : ['spec']);
    types(args, name, { width: 'number', minText: 'number', out: 'string', strict: 'boolean' });
    const props = spec(args.spec, name);
    const opts = { width: args.width as number | undefined, minText: args.minText as number | undefined };
    const rendered = render(props, opts);
    const findings = sortFindings(checkRendered(props, opts, rendered.scene), args.strict === true);
    const errors = findings.some((f) => f.severity === 'error');
    const lines = reportLines(props, findings);
    if (name === 'check' || errors) return ok(lines.join('\n'), errors);
    const out = String(args.out);
    const svg = svgWithSpec(props, opts, rendered.svg);
    try {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, svg);
    } catch (e) {
      throw new Fault(`${out}: ${(e as Error).message}`);
    }
    return ok([...lines, ...summaryLines(props), ...verifyLines(props, out), `${out} — ${(svg.length / 1024).toFixed(1)} kB`].join('\n'));
  }
  if (name === 'verify') {
    need(args, name, ['paths']);
    if (!Array.isArray(args.paths) || args.paths.some((p) => typeof p !== 'string'))
      throw new Bad('verify: paths must be an array of strings');
    types(args, name, { root: 'string', strict: 'boolean' });
    const root = args.root == null ? process.cwd() : String(args.root);
    const lines: string[] = [];
    const counts: string[] = [];
    let errors = 0;
    for (const p of args.paths as string[]) {
      let props;
      try {
        props = spec(p, 'verify');
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
        errors++;
        lines.push(`${'error'.padEnd(8)} ${'missing-file'.padEnd(18)} ${e.message}`);
        continue;
      }
      const report = verifyReport(props, { root });
      counts.push(coverageLine(p, report.coverage), ...unsureLines(report.coverage));
      const findings = sortFindings([...check(props), ...report.findings], args.strict === true);
      errors += findings.filter((f) => f.severity === 'error').length;
      lines.push(...findings.map((f) => `${f.severity.padEnd(8)} ${f.rule.padEnd(18)} ${p}: ${f.message}`));
    }
    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const total = lines.length;
    lines.push(`${n(errors, 'error')}, ${n(total - errors, 'warning')}`, ...counts);
    return ok(lines.join('\n'), errors > 0);
  }
  if (name === 'diff') {
    need(args, name, ['old', 'new']);
    return ok(formatDiff(diff(spec(args.old, 'diff'), spec(args.new, 'diff')), 'md'));
  }
  throw new Bad(`unknown tool "${name}"`);
}

const reply = (id: unknown, result: unknown): Response => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string): Response => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Returns `undefined` for a notification. */
export function handle(message: unknown): Response | undefined {
  if (typeof message !== 'object' || message === null) return fail(null, -32600, 'invalid request');
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  const notification = id === undefined;
  if (typeof method !== 'string') return notification ? undefined : fail(id, -32600, 'invalid request');
  if (notification) return undefined;
  const info = { name: 'flowfig', version: VERSION };
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: info,
        });
      case 'server/discover':
        return reply(id, {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': info },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const name = String(params?.name ?? '');
        if (!TOOLS.some((t) => t.name === name)) throw new Bad(`unknown tool "${name}"`);
        return reply(id, run(name, (params?.arguments as Record<string, unknown>) ?? {}));
      }
      default:
        return fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    if (e instanceof Bad) return fail(id, -32602, e.message);
    if (e instanceof Fault) return reply(id, ok(e.message, true));
    return fail(id, -32603, (e as Error).message);
  }
}

export async function serve(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(JSON.stringify(fail(null, -32700, 'parse error')) + '\n');
      continue;
    }
    const response = handle(message);
    if (response) output.write(JSON.stringify(response) + '\n');
  }
}
