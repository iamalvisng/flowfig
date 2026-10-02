// `flowfig init`: write flowfig instructions for the coding agents of a repo. Pure functions where possible, so the tests need no TTY.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  /** The MCP config file the agent reads, and the top-level key that holds the servers. `type` adds `"type": "stdio"`. */
  mcp?: { file: string; key: 'mcpServers' | 'servers'; type?: true; global?: string };
  /** Shown in place of the MCP file when init cannot write the config. */
  mcpNote?: string;
  /** A second file, a marked section in a file the user owns. Written only in a repo run, never with `--global`. */
  also?: { file: string; text: string };
};

export const MCP_ENTRY = { command: 'npx', args: ['flowfig', 'mcp'] };

export const AGENTS: Agent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    marks: ['.claude/', 'CLAUDE.md'],
    file: '.claude/skills/figure/SKILL.md',
    kind: 'whole',
    mcp: { file: '.mcp.json', key: 'mcpServers', type: true, global: '.claude.json' },
    also: {
      file: 'CLAUDE.md',
      text: '## Diagrams\nDraw every diagram with the `figure` skill (flowfig). The user can run `/figure <question>`. Do not answer a diagram request with a Mermaid block or ASCII art, unless the user asks for that tool.',
    },
    head: `---\nname: figure\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\nuser_invocable: true\n---\n\n`,
  },
  { id: 'agents', name: 'AGENTS.md', marks: ['AGENTS.md'], file: 'AGENTS.md', kind: 'section', note: 'Codex, Amp, Jules, ...' },
  {
    id: 'cursor',
    name: 'Cursor',
    marks: ['.cursor/', '.cursorrules'],
    file: '.cursor/rules/flowfig.mdc',
    kind: 'whole',
    mcp: { file: '.cursor/mcp.json', key: 'mcpServers', type: true, global: '.cursor/mcp.json' },
    head: '---\ndescription: Draw diagrams and flow figures with flowfig\nalwaysApply: false\n---\n\n',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    marks: ['.github/copilot-instructions.md'],
    file: '.github/copilot-instructions.md',
    kind: 'section',
    mcp: { file: '.vscode/mcp.json', key: 'servers', type: true },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    marks: ['GEMINI.md', '.gemini/'],
    file: 'GEMINI.md',
    kind: 'section',
    mcp: { file: '.gemini/settings.json', key: 'mcpServers', global: '.gemini/settings.json' },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    marks: ['.windsurf/', '.windsurfrules'],
    file: '.windsurf/rules/flowfig.md',
    kind: 'whole',
    mcpNote: 'add {"command":"npx","args":["flowfig","mcp"]} to the MCP config by hand',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    marks: ['.kiro/'],
    file: '.kiro/steering/flowfig.md',
    kind: 'whole',
    mcp: { file: '.kiro/settings/mcp.json', key: 'mcpServers', global: '.kiro/settings/mcp.json' },
  },
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

const block = (text = AGENT_TEXT) => `${START}\n${text.trimEnd()}\n${END}\n`;

/** The new file text, or `undefined` if the file belongs to the user and init must leave it. `old` is `undefined` for a missing file. */
export function place(a: Agent, old: string | undefined): string | undefined {
  const mine = block();
  if (a.kind === 'whole') return old === undefined || old.includes(START) ? `${a.head ?? ''}${mine}` : undefined;
  return section(old, mine);
}

/** `old` with the marked block `mine` added or replaced. `undefined` if the block is open. */
function section(old: string | undefined, mine: string): string | undefined {
  if (old === undefined) return mine;
  const s = old.indexOf(START),
    e = old.indexOf(END, s);
  if (s !== -1 && e === -1) return undefined; // an open block: the next run would eat the text after START
  if (s !== -1) return old.slice(0, s) + mine.trimEnd() + old.slice(e + END.length);
  return old + (old.endsWith('\n\n') ? '' : old.endsWith('\n') ? '\n' : '\n\n') + mine;
}

/** The MCP file with the flowfig entry merged in, or `undefined` when the file is not a JSON object that can hold it. */
export function registerMcp(a: Agent, old: string | undefined): string | undefined {
  if (!a.mcp) return undefined;
  let json: Record<string, unknown>;
  try {
    json = old === undefined ? {} : JSON.parse(old);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const servers = json[a.mcp.key] ?? {};
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return undefined;
  if ('flowfig' in servers) return old; // the user may have pinned a version or set env: keep the entry
  const entry = a.mcp.type ? { ...MCP_ENTRY, type: 'stdio' } : MCP_ENTRY;
  json[a.mcp.key] = { ...(servers as object), flowfig: entry };
  return JSON.stringify(json, null, 2) + '\n';
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
    dry = flag('--dry-run'),
    noMcp = flag('--no-mcp');
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

  if (global && ids?.some((i) => i !== 'claude'))
    return fail('init: --global writes only the Claude skill and the MCP entry (use --agents claude)');
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
    const files = [{ file: a.file, place: (o?: string) => place(a, o) }];
    if (a.also && !global) files.push({ file: a.also.file, place: (o) => section(o, block(a.also!.text)) });
    for (const f of files) {
      const path = global ? join(homedir(), f.file) : join(dir, f.file);
      const old = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
      const next = f.place(old);
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
    if (noMcp) continue;
    if (a.mcpNote) {
      console.log(`note      ${a.id}: ${a.mcpNote}`);
      continue;
    }
    if (!a.mcp || (global && !a.mcp.global)) continue;
    const mcpPath = global ? join(homedir(), a.mcp.global!) : join(dir, a.mcp.file);
    const oldMcp = existsSync(mcpPath) ? readFileSync(mcpPath, 'utf8') : undefined;
    const nextMcp = registerMcp(a, oldMcp);
    let mcpStatus: string;
    if (nextMcp === undefined) mcpStatus = `skipped (not a JSON object with ${a.mcp.key})`;
    else if (nextMcp === oldMcp) mcpStatus = 'unchanged';
    else {
      mcpStatus = oldMcp === undefined ? 'created' : 'updated';
      if (dry) mcpStatus = `would ${mcpStatus === 'created' ? 'create' : 'update'}`;
      else {
        mkdirSync(dirname(mcpPath), { recursive: true });
        // Same-folder temp file, then rename: a crash or a parallel write cannot leave half a file (~/.claude.json holds user settings).
        // Resolve a symlink first, so the rename replaces the target and not the link. Copy the old mode to the new file.
        const real = existsSync(mcpPath) ? realpathSync(mcpPath) : mcpPath;
        const tmp = `${real}.${process.pid}.tmp`;
        try {
          writeFileSync(tmp, nextMcp);
          if (existsSync(real)) chmodSync(tmp, statSync(real).mode & 0o777);
          renameSync(tmp, real);
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
      }
    }
    console.log(`${mcpStatus.padEnd(9)} ${mcpPath}`);
  }
  if (!dry)
    console.log(`Next: start a new agent session.${chosen.has('claude') ? ' In Claude Code, run /figure how does login work.' : ''}`);
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
