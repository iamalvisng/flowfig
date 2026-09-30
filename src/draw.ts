// `flowfig draw`: one command to the first figure. Claude Code reads the repo and renders; draw checks the result itself.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AGENT_TEXT } from './guide.ts';
import { loadSpec, reportLines, sortFindings } from './load.ts';
import { check } from './svg.ts';
import { verify } from './verify.ts';

const ALLOWED = 'Read,Glob,Grep,Bash(npx flowfig *)';
const USAGE = 'usage: flowfig draw "<question>" [--out <path>] [--model <alias>] [--max-turns <n>] [--json]';

/** A file name from the question: lower case, letters and digits, joined by -, at most 60 characters. */
export function slug(question: string): string {
  const s = question
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join('-')
    .slice(0, 60)
    .replace(/-$/, '');
  return s || 'figure';
}

/** The claude argv after the binary. The system prompt carries the agent text, the output path and the folder rule. */
export function agentArgs(o: { question: string; out: string; cwd: string; maxTurns: number; model?: string }): string[] {
  const system = `${AGENT_TEXT.trimEnd()}\n\nWrite the SVG to ${o.out} with \`npx flowfig - ${o.out} <<'SPEC'\` and the JSON in the heredoc. Run every command from this folder, ${o.cwd}.`;
  const args = [
    '-p',
    o.question,
    '--output-format',
    'json',
    '--max-turns',
    String(o.maxTurns),
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ALLOWED,
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

/** Run `flowfig draw`. Prints, and returns the exit code. */
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
  let json: boolean, outArg: string | undefined, model: string | undefined, turns: string | undefined;
  try {
    json = flag('--json');
    outArg = value('--out');
    model = value('--model');
    turns = value('--max-turns');
  } catch (e) {
    if (e instanceof Bad) return fail(`draw: ${e.message}\n${USAGE}`, 2);
    throw e;
  }
  const maxTurns = turns === undefined ? 40 : Number(turns);
  if (!(maxTurns > 0)) return fail('--max-turns needs a positive number', 2);
  const bad = args.find((a) => a.startsWith('-'));
  if (bad) return fail(`draw: unknown flag ${bad}\n${USAGE}`, 2);
  const question = args.join(' ').trim();
  if (!question) return fail(`draw needs a question\n${USAGE}`, 2);

  const bin = process.env.FLOWFIG_CLAUDE_BIN || 'claude';
  const shell = process.platform === 'win32';
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8', shell });
  if (version.error || version.status !== 0) return fail('draw needs Claude Code: npm i -g @anthropic-ai/claude-code', 2);
  if (!process.env.ANTHROPIC_API_KEY) {
    const auth = spawnSync(bin, ['auth', 'status'], { encoding: 'utf8', shell });
    if (auth.status !== 0) return fail('claude is not logged in: run claude once', 2);
  }

  const cwd = process.cwd();
  const out = outArg ?? `${slug(question)}.svg`;
  mkdirSync(dirname(resolve(cwd, out)), { recursive: true });
  const run = spawnSync(bin, agentArgs({ question, out, cwd, maxTurns, model }), {
    cwd,
    encoding: 'utf8',
    shell,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  // The JSON is the last line that starts with {: a warning line may come before it.
  const line = (run.stdout ?? '')
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'));
  let reply = '',
    cost: number | undefined,
    session: string | undefined;
  try {
    const parsed = JSON.parse(line ?? '');
    reply = String(parsed.result ?? '');
    cost = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined;
    session = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;
  } catch {
    process.stderr.write(run.stdout ?? '');
    return fail(`draw: claude failed (exit ${run.status ?? 'null'})`, 1);
  }

  const full = resolve(cwd, out);
  if (!existsSync(full)) {
    if (!json) console.log(reply);
    return fail(`draw: the agent wrote no figure at ${out}`, 1);
  }
  let props;
  try {
    props = loadSpec(full);
  } catch (e) {
    return fail(`draw: ${(e as Error).message}`, 1);
  }
  const findings = sortFindings([...check(props), ...verify(props, { root: cwd })], true);
  const errors = findings.length > 0;
  if (json) console.log(JSON.stringify({ out, reply, cost, session, findings }, null, 2));
  else {
    for (const l of reportLines(props, findings)) console.log(l);
    console.log('');
    console.log(reply);
    console.log(`agent: claude, $${cost === undefined ? '?' : cost.toFixed(4)}, session ${session ?? '?'}`);
  }
  return errors ? 1 : 0;
}
