import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, MCP_ENTRY, detect, registerMcp, renderList, toggle } from './init.ts';
import { SKILL_DESCRIPTION } from './guide.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'flowfig-init-'));
const run = (args: string[], cwd: string, env: Record<string, string> = {}, input?: string) =>
  spawnSync('node', [cli, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, ...env } });

test('detect finds each agent from its marker, and none in an empty dir', () => {
  const marks: Record<string, string[]> = {
    claude: ['.claude/', 'CLAUDE.md'],
    agents: ['AGENTS.md'],
    cursor: ['.cursor/', '.cursorrules'],
    copilot: ['.github/copilot-instructions.md'],
    gemini: ['GEMINI.md', '.gemini/'],
    windsurf: ['.windsurf/', '.windsurfrules'],
    kiro: ['.kiro/'],
  };
  assert.equal(AGENTS.length, 7);
  const empty = tmp();
  try {
    assert.deepEqual(detect(empty), []);
    for (const [id, list] of Object.entries(marks))
      for (const m of list) {
        const dir = tmp();
        try {
          if (m.endsWith('/')) mkdirSync(join(dir, m), { recursive: true });
          else {
            mkdirSync(dirname(join(dir, m)), { recursive: true });
            writeFileSync(join(dir, m), 'x');
          }
          assert.deepEqual(detect(dir), [id], m);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('toggle parses numbers, and renderList shows the marks', () => {
  assert.deepEqual([...toggle('1 3', new Set(['claude']), 7)].sort(), ['cursor']);
  const on = toggle('2,3', new Set(['claude']), 7);
  assert.deepEqual([...on].sort(), ['agents', 'claude', 'cursor']);
  assert.deepEqual([...toggle('1 1', new Set(), 7)], []); // twice = off again
  assert.deepEqual([...toggle('9 x', new Set(['kiro']), 7)], ['kiro']); // out of range and junk are ignored
  const dir = tmp();
  mkdirSync(join(dir, '.claude'));
  const text = renderList(new Set(['claude']), ['claude'], dir);
  rmSync(dir, { recursive: true, force: true });
  assert.match(text, /\[x\] 1 +Claude Code +\(\.claude\/ found\)/);
  assert.match(text, /\[ \] 2 +AGENTS\.md/);
  assert.match(text, /Enter to write, q to quit/);
});

test('--agents agents adds a section and keeps the other text byte for byte', () => {
  const dir = tmp();
  try {
    const before = '# Mine\n\nKeep this.\n';
    writeFileSync(join(dir, 'AGENTS.md'), before);
    const r = run(['init', '--agents', 'agents'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /updated .*AGENTS\.md/);
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(after.startsWith(before));
    assert.equal(after.match(/<!-- flowfig:start -->/g)?.length, 1);
    assert.match(after, /npx flowfig docs/);
    const again = run(['init', '--agents', 'agents'], dir);
    assert.match(again.stdout, /unchanged .*AGENTS\.md/);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), after);
    // text around the markers stays as it is on a second run
    writeFileSync(join(dir, 'AGENTS.md'), after + '\nTail.\n');
    run(['init', '--agents', 'agents'], dir);
    assert.ok(readFileSync(join(dir, 'AGENTS.md'), 'utf8').endsWith('\nTail.\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing shared file is created; a whole-file target is written with the skill frontmatter', () => {
  const dir = tmp();
  try {
    const r = run(['init', '--agents', 'claude,copilot'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /created .*SKILL\.md/);
    const skill = readFileSync(join(dir, '.claude/skills/figure/SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: figure\ndescription: .*diagram/);
    assert.ok(existsSync(join(dir, '.github/copilot-instructions.md')));
    assert.match(run(['init', '--agents', 'claude'], dir).stdout, /unchanged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a whole-file target the user wrote is skipped', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, '.cursor/rules'), { recursive: true });
    writeFileSync(join(dir, '.cursor/rules/flowfig.mdc'), 'my own rules\n');
    const r = run(['init', '--agents', 'cursor'], dir);
    assert.match(r.stdout, /skipped \(/);
    assert.equal(readFileSync(join(dir, '.cursor/rules/flowfig.mdc'), 'utf8'), 'my own rules\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run writes nothing', () => {
  const dir = tmp();
  try {
    const r = run(['init', '--all-agents', '--dry-run'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would create/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('-y uses the detected agents, or agents when none; a [dir] argument works', () => {
  const dir = tmp();
  try {
    assert.equal(run(['init', '-y'], dir).status, 0);
    assert.ok(existsSync(join(dir, 'AGENTS.md')));
    assert.ok(!existsSync(join(dir, '.claude')));
    const other = tmp();
    mkdirSync(join(other, '.kiro'));
    run(['init', '-y', other], dir);
    assert.ok(existsSync(join(other, '.kiro/steering/flowfig.md')));
    rmSync(other, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--global puts the Claude skill under HOME', () => {
  const dir = tmp(),
    home = tmp();
  try {
    const r = run(['init', '--agents', 'claude', '--global'], dir, { HOME: home, USERPROFILE: home });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(home, '.claude/skills/figure/SKILL.md')));
    assert.ok(!existsSync(join(dir, '.claude')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('--list-agents prints all 7 ids', () => {
  const r = run(['init', '--list-agents'], tmp());
  assert.equal(r.status, 0);
  for (const a of AGENTS) assert.match(r.stdout, new RegExp(`^${a.id} `, 'm'));
});

test('no TTY and no flag: exit 2 with the hint; an unknown id also exits 2', () => {
  const dir = tmp();
  try {
    const r = run(['init'], dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr + r.stdout, /run with -y or --agents <ids>/);
    assert.equal(run(['init', '--agents', 'nope'], dir).status, 2);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the picker names the marker that exists, not the first one', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), '# x\n');
    const text = renderList(new Set(), detect(dir), dir);
    assert.match(text, /\(CLAUDE\.md found\)/);
    assert.doesNotMatch(text, /\.claude\/ found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the skill description is a JSON string in the frontmatter, so YAML parsers accept it', () => {
  const dir = tmp();
  try {
    assert.equal(run(['init', '--agents', 'claude'], dir).status, 0);
    const head = readFileSync(join(dir, '.claude/skills/figure/SKILL.md'), 'utf8');
    const line = head.split('\n').find((l) => l.startsWith('description: '))!;
    assert.equal(JSON.parse(line.slice('description: '.length)), SKILL_DESCRIPTION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a section file with a start marker and no end marker is skipped and keeps the user text', () => {
  const dir = tmp();
  try {
    const text = 'top\n<!-- flowfig:start -->\nUSER KEEP THIS\n';
    writeFileSync(join(dir, 'AGENTS.md'), text);
    for (let i = 0; i < 2; i++) {
      const r = run(['init', '--agents', 'agents'], dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /skipped \(flowfig:start without flowfig:end\)/);
      assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), text);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--global -y writes only the Claude skill under HOME, and no file in the directory', () => {
  const dir = tmp(),
    home = tmp();
  try {
    const env = { HOME: home, USERPROFILE: home };
    const r = run(['init', '--global', '-y'], dir, env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(home, '.claude/skills/figure/SKILL.md')));
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(run(['init', '--global', '--agents', 'cursor'], dir, env).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('registerMcp merges one entry and keeps every other key and server', () => {
  const claude = AGENTS.find((a) => a.id === 'claude')!;
  assert.equal(
    registerMcp(claude, undefined),
    JSON.stringify({ mcpServers: { flowfig: { ...MCP_ENTRY, type: 'stdio' } } }, null, 2) + '\n',
  );
  const old = JSON.stringify({ theme: 'dark', mcpServers: { graft: { command: 'graft', args: ['mcp'] } }, other: [1] }, null, 2);
  const next = JSON.parse(registerMcp(claude, old)!);
  assert.deepEqual(Object.keys(next), ['theme', 'mcpServers', 'other']);
  assert.deepEqual(Object.keys(next.mcpServers), ['graft', 'flowfig']);
  assert.equal(registerMcp(claude, registerMcp(claude, old)), registerMcp(claude, old));
  assert.equal(registerMcp(claude, '{ not json'), undefined);
  assert.equal(registerMcp(claude, JSON.stringify({ mcpServers: [] })), undefined);
  const copilot = AGENTS.find((a) => a.id === 'copilot')!;
  assert.deepEqual(JSON.parse(registerMcp(copilot, undefined)!), { servers: { flowfig: { ...MCP_ENTRY, type: 'stdio' } } });
  const gemini = AGENTS.find((a) => a.id === 'gemini')!;
  assert.deepEqual(JSON.parse(registerMcp(gemini, undefined)!), { mcpServers: { flowfig: MCP_ENTRY } });
});

test('init writes the MCP file for each agent that has one, and --no-mcp or --dry-run writes none', () => {
  const dir = tmp();
  try {
    const r = run(['init', '--agents', 'claude,cursor,copilot,gemini,kiro,windsurf,agents', dir], dir);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.gemini/settings.json', '.kiro/settings/mcp.json'])
      assert.ok(existsSync(join(dir, f)), f);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.vscode/mcp.json'), 'utf8')).servers.flowfig, { ...MCP_ENTRY, type: 'stdio' });
    assert.match(r.stdout, /created {3}.*\.mcp\.json/);
    assert.match(r.stdout, /note {6}windsurf: add/);
    const again = run(['init', '--agents', 'claude', dir], dir);
    assert.match(again.stdout, /unchanged .*\.mcp\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const dir2 = tmp();
  try {
    run(['init', '--agents', 'claude', '--no-mcp', dir2], dir2);
    assert.equal(existsSync(join(dir2, '.mcp.json')), false);
    const dry = run(['init', '--agents', 'claude', '--dry-run', dir2], dir2);
    assert.match(dry.stdout, /would create .*\.mcp\.json/);
    assert.equal(existsSync(join(dir2, '.mcp.json')), false);
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

test('--global registers the Claude server in ~/.claude.json and keeps the rest of that file', () => {
  const home = tmp();
  try {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { graft: { command: 'graft' } } }));
    const r = run(['init', '--global'], home, { HOME: home, USERPROFILE: home });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    assert.equal(j.numStartups, 3);
    assert.deepEqual(Object.keys(j.mcpServers), ['graft', 'flowfig']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
