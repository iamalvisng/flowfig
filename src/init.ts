// `flowfig init`: write flowfig instructions for the coding agents of a repo. Pure functions where possible, so the tests need no TTY.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { AGENT_TEXT, SKILL_DESCRIPTION } from './guide.ts';

const START = '<!-- flowfig:start -->';
const END = '<!-- flowfig:end -->';

type Agent = {
  id: string;
  name: string;
  /** Paths whose presence means the repo uses the agent. A trailing `/` means a directory. */
  marks: string[];
  /** The file init writes, relative to the repo. */
  file: string;
  /** `section` edits a file the user owns; `whole` owns the file. */
  kind: 'section' | 'whole';
  /** Text before the marked block in a whole file. */
  head?: string;
  note?: string;
};

export const AGENTS: Agent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    marks: ['.claude/', 'CLAUDE.md'],
    file: '.claude/skills/figure/SKILL.md',
    kind: 'whole',
    head: `---\nname: figure\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\nuser_invocable: true\n---\n\n`,
  },
  { id: 'agents', name: 'AGENTS.md', marks: ['AGENTS.md'], file: 'AGENTS.md', kind: 'section', note: 'Codex, Amp, Jules, ...' },
  {
    id: 'cursor',
    name: 'Cursor',
    marks: ['.cursor/', '.cursorrules'],
    file: '.cursor/rules/flowfig.mdc',
    kind: 'whole',
    head: '---\ndescription: Draw diagrams and flow figures with flowfig\nalwaysApply: false\n---\n\n',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    marks: ['.github/copilot-instructions.md'],
    file: '.github/copilot-instructions.md',
    kind: 'section',
  },
  { id: 'gemini', name: 'Gemini CLI', marks: ['GEMINI.md', '.gemini/'], file: 'GEMINI.md', kind: 'section' },
  { id: 'windsurf', name: 'Windsurf', marks: ['.windsurf/', '.windsurfrules'], file: '.windsurf/rules/flowfig.md', kind: 'whole' },
  { id: 'kiro', name: 'Kiro', marks: ['.kiro/'], file: '.kiro/steering/flowfig.md', kind: 'whole' },
];

/** The ids of the agents that the repo at `dir` already uses. */
export const detect = (dir: string): string[] => AGENTS.filter((a) => a.marks.some((m) => existsSync(join(dir, m)))).map((a) => a.id);

/** Toggle the agents named by numbers ("1 3" or "1,3"). A number out of range and other text are ignored. */
export function toggle(input: string, selected: Set<string>, count: number): Set<string> {
  const next = new Set(selected);
  for (const t of input.split(/[\s,]+/)) {
    const n = /^\d+$/.test(t) ? Number(t) : 0;
    const id = n >= 1 && n <= count ? AGENTS[n - 1].id : undefined;
    if (id) next.has(id) ? next.delete(id) : next.add(id);
  }
  return next;
}

/** The picker screen. */
export function renderList(selected: Set<string>, detected: string[], dir: string): string {
  const rows = AGENTS.map((a, i) => {
    const found = detected.includes(a.id) ? `(${a.marks.find((m) => existsSync(join(dir, m)))} found)` : '';
    const dest = a.kind === 'whole' ? a.file : `section in ${a.file}${a.note ? `  (${a.note})` : ''}`;
    return `  [${selected.has(a.id) ? 'x' : ' '}] ${i + 1}  ${a.name.padEnd(15)} ${found.padEnd(20)} → ${dest}`;
  });
  return [
    'flowfig: pick the coding agents that should draw diagrams in this repo',
    '',
    ...rows,
    'Type numbers to toggle (for example "1 3"), Enter to write, q to quit.',
  ].join('\n');
}

const block = () => `${START}\n${AGENT_TEXT.trimEnd()}\n${END}\n`;

/** The new file text, or `undefined` if the file belongs to the user and init must leave it. `old` is `undefined` for a missing file. */
export function place(a: Agent, old: string | undefined): string | undefined {
  const mine = block();
  if (a.kind === 'whole') return old === undefined || old.includes(START) ? `${a.head ?? ''}${mine}` : undefined;
  if (old === undefined) return mine;
  const s = old.indexOf(START),
    e = old.indexOf(END, s);
  if (s !== -1 && e === -1) return undefined; // an open block: the next run would eat the text after START
  if (s !== -1) return old.slice(0, s) + mine.trimEnd() + old.slice(e + END.length);
  return old + (old.endsWith('\n\n') ? '' : old.endsWith('\n') ? '\n' : '\n\n') + mine;
}

const HINT = 'run with -y or --agents <ids>';

/** Run `flowfig init`. Returns the exit code. */
export async function runInit(argv: string[]): Promise<number> {
  const args = [...argv];
  const flag = (n: string, ...alias: string[]) => [n, ...alias].some((x) => args.includes(x) && args.splice(args.indexOf(x), 1).length > 0);
  const listAgents = flag('--list-agents'),
    all = flag('--all-agents'),
    yes = flag('-y', '--yes'),
    global = flag('--global'),
    dry = flag('--dry-run');
  let ids: string[] | undefined;
  const at = args.indexOf('--agents');
  if (at !== -1) ids = (args.splice(at, 2)[1] ?? '').split(',').filter(Boolean);
  const bad = args.find((a) => a.startsWith('-'));
  if (bad) return fail(`init: unknown flag ${bad}`);
  const dir = resolve(args[0] ?? '.');

  if (listAgents) {
    for (const a of AGENTS) console.log(`${a.id.padEnd(9)}${a.name}`);
    return 0;
  }
  const unknown = ids?.find((i) => !AGENTS.some((a) => a.id === i));
  if (unknown) return fail(`init: unknown agent "${unknown}" (ids: ${AGENTS.map((a) => a.id).join(', ')})`);

  if (global && ids?.some((i) => i !== 'claude')) return fail('init: --global writes only the claude skill (use --agents claude)');
  const detected = detect(dir);
  const auto = new Set(detected.length ? detected : ['agents']);
  let chosen: Set<string>;
  if (global) chosen = new Set(['claude']);
  else if (all) chosen = new Set(AGENTS.map((a) => a.id));
  else if (ids) chosen = new Set(ids);
  else if (yes) chosen = auto;
  else if (!process.stdin.isTTY) {
    for (const a of AGENTS) console.log(`${a.id.padEnd(9)}${a.name}`);
    return fail(HINT);
  } else {
    const picked = await pick(auto, detected, dir);
    if (!picked) return 0;
    chosen = picked;
  }

  for (const a of AGENTS.filter((x) => chosen.has(x.id))) {
    const path = global ? join(homedir(), a.file) : join(dir, a.file);
    const old = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    const next = place(a, old);
    let status: string;
    if (next === undefined)
      status = old?.includes(START) ? 'skipped (flowfig:start without flowfig:end)' : 'skipped (the file exists and is not from flowfig)';
    else if (next === old) status = 'unchanged';
    else {
      status = old === undefined ? 'created' : 'updated';
      if (dry) status = `would ${status === 'created' ? 'create' : 'update'}`;
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, next);
      }
    }
    console.log(`${status.padEnd(9)} ${path}`);
  }
  return 0;
}

function fail(message: string): number {
  console.error(message);
  return 2;
}

/** Ask on the terminal. Returns the chosen ids, or `undefined` if the user quits. */
async function pick(start: Set<string>, detected: string[], dir: string): Promise<Set<string> | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string | undefined>((res) => (rl.once('close', () => res(undefined)), rl.question(q, res)));
  let selected = start;
  try {
    for (;;) {
      console.log(`\n${renderList(selected, detected, dir)}`);
      const line = (await ask('> '))?.trim();
      if (line === undefined || line.toLowerCase() === 'q') return undefined;
      if (line === '') return selected;
      selected = toggle(line, selected, AGENTS.length);
    }
  } finally {
    rl.close();
  }
}
