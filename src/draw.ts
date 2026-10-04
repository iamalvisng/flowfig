import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AGENT_TEXT } from './guide.ts';
import { loadSpec, reportLines, sortFindings } from './load.ts';
import { openedLine, openSvg } from './open.ts';
import { check } from './svg.ts';
import { verify } from './verify.ts';

const ALLOWED = 'Read,Glob,Grep,Bash(npx flowfig *)';
const DISALLOWED = 'Edit,MultiEdit,NotebookEdit';
const USAGE = 'usage: flowfig draw "<question>" [--out <path>] [--model <alias>] [--max-turns <n>] [--json] [--open]';

/** A file name from the question: at most 60 characters. */
export function slug(question: string): string {
  const s = question
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join('-')
    .slice(0, 60)
    .replace(/-$/, '');
  return s || 'figure';
}

const specPath = (out: string) => out.replace(/\.svg$/, '.json');

export function agentArgs(o: { question: string; out: string; cwd: string; maxTurns: number; model?: string }): string[] {
  const spec = specPath(o.out);
  const system = `${AGENT_TEXT.trimEnd()}\n\nWrite the spec to ${spec} with the Write tool. Then run exactly \`npx flowfig ${spec} ${o.out}\` as one command, alone on its line: no heredoc, no \`;\`, no \`&&\`, no pipe (the permission rule matches one plain command only). Then run \`npx flowfig verify ${o.out}\` the same way. Run every command from this folder, ${o.cwd}.`;
  const args = [
    '-p',
    o.question,
    '--output-format',
    'json',
    '--max-turns',
    String(o.maxTurns),
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ALLOWED,
    '--disallowedTools',
    DISALLOWED,
    '--append-system-prompt',
    system,
  ];
  if (o.model) args.push('--model', o.model);
  return args;
}

class Bad extends Error {}

const fail = (message: string, code: number) => {
  console.error(message);
  return code;
};

export async function runDraw(argv: string[]): Promise<number> {
  const args = [...argv];
  const flag = (n: string) => args.includes(n) && args.splice(args.indexOf(n), 1).length > 0;
  const value = (n: string) => {
    const i = args.indexOf(n);
    if (i === -1) return undefined;
    const v = args.splice(i, 2)[1];
    if (v === undefined) throw new Bad(`${n} needs a value`);
    return v;
  };
  let json: boolean, open: boolean, outArg: string | undefined, model: string | undefined, turns: string | undefined;
  try {
    json = flag('--json');
    open = flag('--open');
    outArg = value('--out');
    model = value('--model');
    turns = value('--max-turns');
  } catch (e) {
    if (e instanceof Bad) return fail(`draw: ${e.message}\n${USAGE}`, 2);
    throw e;
  }
  const maxTurns = turns === undefined ? 40 : Number(turns);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) return fail(`draw: --max-turns needs a positive whole number\n${USAGE}`, 2);
  const bad = args.find((a) => a.startsWith('-'));
  if (bad) return fail(`draw: unknown flag ${bad}\n${USAGE}`, 2);
  const question = args.join(' ').trim();
  if (!question) return fail(`draw needs a question\n${USAGE}`, 2);

  if (process.platform === 'win32') return fail('draw does not run on Windows yet', 2);
  const bin = process.env.FLOWFIG_CLAUDE_BIN || 'claude';
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) return fail('draw needs Claude Code: npm i -g @anthropic-ai/claude-code', 2);

  const cwd = process.cwd();
  const out = outArg ?? `${slug(question)}.svg`;
  if (!out.endsWith('.svg')) return fail(`draw: --out needs a .svg path\n${USAGE}`, 2);
  const full = resolve(cwd, out);
  try {
    mkdirSync(dirname(full), { recursive: true });
  } catch (e) {
    return fail(`draw: ${(e as Error).message}`, 2);
  }
  // Compare the mtime: a figure from an earlier run must not pass.
  const mtime = () => (existsSync(full) ? statSync(full).mtimeMs : undefined);
  const before = mtime();
  const run = spawnSync(bin, agentArgs({ question, out, cwd, maxTurns, model }), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  // The JSON is the last line that starts with {; a warning can come before.
  const line = (run.stdout ?? '')
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'));
  let reply = '',
    cost: number | null = null,
    session: string | null = null,
    stopped: string | undefined,
    denials: unknown[] = [];
  try {
    const parsed = JSON.parse(line ?? '');
    reply = String(parsed.result ?? '');
    cost = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null;
    session = typeof parsed.session_id === 'string' ? parsed.session_id : null;
    if (parsed.is_error === true) stopped = String(parsed.subtype ?? '?');
    if (Array.isArray(parsed.permission_denials)) denials = parsed.permission_denials;
  } catch {
    process.stderr.write(run.stdout ?? '');
    const message = `claude failed (exit ${run.status ?? 'null'})`;
    if (json) console.log(JSON.stringify({ out, reply, cost, session, findings: [], error: message }, null, 2));
    return fail(`draw: ${message}`, 1);
  }

  const stop = () => {
    if (stopped !== undefined) console.error(`draw: claude stopped (${stopped})`);
  };
  const after = mtime();
  if (after === undefined || after === before) {
    const message = `the agent wrote no figure at ${out}`;
    if (json) console.log(JSON.stringify({ out, reply, cost, session, findings: [], error: message }, null, 2));
    else console.log(reply);
    for (const d of denials as { tool_name?: string; tool_input?: { command?: string; file_path?: string } }[])
      console.error(`denied: ${d.tool_name ?? '?'} ${d.tool_input?.command ?? d.tool_input?.file_path ?? ''}`.trimEnd());
    stop();
    return fail(`draw: ${message}`, 1);
  }
  let props;
  try {
    props = loadSpec(full);
  } catch (e) {
    stop();
    const message = (e as Error).message;
    if (json) console.log(JSON.stringify({ out, reply, cost, session, findings: [], error: message }, null, 2));
    return fail(`draw: ${message}`, 1);
  }
  const findings = sortFindings([...check(props), ...verify(props, { root: cwd })], true);
  const errors = findings.length > 0;
  if (!errors && stopped === undefined) rmSync(specPath(full), { force: true });
  if (json) console.log(JSON.stringify({ out, reply, cost, session, findings }, null, 2));
  else {
    for (const l of reportLines(props, findings)) console.log(l);
    console.log('');
    console.log(reply);
    console.log(`agent: claude, $${cost === null ? '?' : cost.toFixed(4)}, session ${session ?? '?'}`);
  }
  stop();
  let code = errors || stopped !== undefined ? 1 : 0;
  if (open) {
    try {
      const line = openedLine((await openSvg(full))[0]);
      if (json) console.error(line);
      else console.log(line);
    } catch (e) {
      console.error(`open: ${(e as Error).message}`);
      code = 1;
    }
  }
  return code;
}
