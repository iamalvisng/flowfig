import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentArgs, slug } from './draw.ts';
import { AGENT_TEXT } from './guide.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'cli.js');
const posix = process.platform !== 'win32';

test('slug makes a file name from the question', () => {
  assert.equal(slug('How does login work?'), 'how-does-login-work');
  assert.equal(slug('???'), 'figure');
  assert.ok(slug('a'.repeat(100) + ' b').length <= 60);
});

test('agentArgs holds print mode, the allowlist, the turn cap, the system prompt and the model', () => {
  const a = agentArgs({ question: 'q "x" $y', out: 'docs/x.svg', cwd: '/repo', maxTurns: 40 });
  assert.deepEqual(a.slice(0, 2), ['-p', 'q "x" $y']);
  for (const pair of [
    ['--output-format', 'json'],
    ['--max-turns', '40'],
    ['--permission-mode', 'acceptEdits'],
    ['--disallowedTools', 'Edit,MultiEdit,NotebookEdit'],
    ['--allowedTools', 'Read,Glob,Grep,Bash(npx flowfig *)'],
  ])
    assert.equal(a[a.indexOf(pair[0]) + 1], pair[1], pair[0]);
  const sys = a[a.indexOf('--append-system-prompt') + 1];
  assert.ok(sys.startsWith(AGENT_TEXT.split('\n')[0]));
  assert.match(sys, /Write the spec to docs\/x\.json with the Write tool/);
  assert.match(sys, /run exactly `npx flowfig docs\/x\.json docs\/x\.svg`/);
  assert.match(sys, /`npx flowfig verify docs\/x\.svg`/);
  assert.match(sys, /\/repo/);
  assert.equal(a.includes('--model'), false);
  assert.equal(agentArgs({ question: 'q', out: 'o.svg', cwd: '/r', maxTurns: 5, model: 'sonnet' }).at(-1), 'sonnet');
});

// The fake claude: logs its argv, then acts on FAKE_MODE. It renders with the real CLI, so the SVG carries a spec.
const SPEC = JSON.stringify({
  props: {
    layout: {
      children: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'Server', shape: 'store', source: 'src/a.ts#login' },
      ],
    },
    edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
    steps: [{ label: 'write', flow: ['w'] }],
  },
});
const BAD = SPEC.replace('"to":"b"', '"to":"zzz"');
const fake = (dir: string) => {
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_LOG"
if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
out=$(printf '%s\\n' "$@" | sed -n 's/.*Then run exactly \`npx flowfig [^ ]* \\([^\`]*\\)\`.*/\\1/p' | head -1)
case "$FAKE_MODE" in
  ok) printf '%s' '{}' > "\${out%.svg}.json"; printf '%s' '${SPEC}' | node "${cli}" - "$out" >/dev/null 2>&1; echo 'warning: something'; echo '{"result":"drawn","total_cost_usd":0.0123,"session_id":"s1"}';;
  none) echo '{"result":"I could not find the flow"}';;
  bad) printf '%s' '${BAD}' | node "${cli}" - "$out" --no-check >/dev/null 2>&1; echo '{"result":"drawn"}';;
  stopped) echo '{"result":"","is_error":true,"subtype":"error_max_turns"}';;
  denied) echo '{"result":"blocked","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"npx flowfig - x.svg <<EOF"}},{"tool_name":"Write","tool_input":{"file_path":"/r/x.json"}}]}';;
  crash) echo boom >&2; exit 3;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return bin;
};
const draw = (dir: string, mode: string, args: string[]) =>
  spawnSync('node', [cli, 'draw', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOWFIG_CLAUDE_BIN: join(dir, 'claude'), FAKE_MODE: mode, FAKE_LOG: join(dir, 'argv.log') },
  });

test('draw runs the agent, then checks and verifies the figure', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  try {
    fake(dir);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const login = 1;');
    const r = draw(dir, 'ok', ['how does login work?', '--out', 'sub/login.svg']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(dir, 'sub', 'login.svg')));
    assert.match(r.stdout, /0 errors, 0 warnings\nfigure: 2 boxes/);
    assert.match(r.stdout, /\ndrawn\n/);
    assert.match(r.stdout, /agent: claude, \$0\.0123, session s1/);
    const argv = readFileSync(join(dir, 'argv.log'), 'utf8').split('\n');
    assert.equal(argv[1], 'how does login work?');
    assert.ok(argv.includes('Read,Glob,Grep,Bash(npx flowfig *)'));
    assert.equal(argv[argv.indexOf('--max-turns') + 1], '40');
    const j = draw(dir, 'ok', ['how does login work?', '--out', 'sub/login2.svg', '--json']);
    const parsed = JSON.parse(j.stdout);
    assert.equal(existsSync(join(dir, 'sub', 'login.json')), false, 'the spec file is removed');
    assert.deepEqual(Object.keys(parsed), ['out', 'reply', 'cost', 'session', 'findings']);
    assert.equal(parsed.reply, 'drawn');
    const d = draw(dir, 'ok', ['How does login work?']);
    assert.ok(existsSync(join(dir, 'how-does-login-work.svg')), d.stdout + d.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('draw exits 1 when the agent writes no figure, when the figure has a fault, or when claude fails', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  try {
    fake(dir);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const login = 1;');
    const none = draw(dir, 'none', ['q', '--out', 'x.svg']);
    assert.equal(none.status, 1);
    assert.match(none.stdout, /I could not find the flow/);
    assert.match(none.stderr, /wrote no figure at x\.svg/);
    const bad = draw(dir, 'bad', ['q', '--out', 'y.svg']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /unknown-id/);
    const denied = draw(dir, 'denied', ['q', '--out', 'x2.svg']);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /denied: Bash npx flowfig - x\.svg <<EOF\ndenied: Write \/r\/x\.json/);
    const stopped = draw(dir, 'stopped', ['q', '--out', 'x3.svg']);
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr, /draw: claude stopped \(error_max_turns\)/);
    // an old clean figure must not pass when the agent writes nothing
    assert.equal(draw(dir, 'ok', ['q', '--out', 'old.svg']).status, 0);
    const stale = draw(dir, 'none', ['q', '--out', 'old.svg']);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /wrote no figure at old\.svg/);
    const j = draw(dir, 'crash', ['q', '--out', 'z2.svg', '--json']);
    assert.equal(j.status, 1);
    assert.deepEqual(JSON.parse(j.stdout), {
      out: 'z2.svg',
      reply: '',
      cost: null,
      session: null,
      findings: [],
      error: 'claude failed (exit 3)',
    });
    const nocost = JSON.parse(draw(dir, 'none', ['q', '--out', 'n.svg', '--json']).stdout);
    assert.deepEqual(Object.keys(nocost), ['out', 'reply', 'cost', 'session', 'findings', 'error']);
    const crash = draw(dir, 'crash', ['q', '--out', 'z.svg']);
    assert.equal(crash.status, 1);
    assert.match(crash.stderr, /claude failed \(exit 3\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('draw exits 2 before the run for a bad --out, a bad --max-turns or a bad folder', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  try {
    fake(dir);
    assert.equal(draw(dir, 'none', ['q', '--out', 'x.png']).status, 2);
    assert.equal(draw(dir, 'none', ['q', '--max-turns', '2.5']).status, 2);
    assert.equal(draw(dir, 'none', ['q', '--max-turns', '0']).status, 2);
    writeFileSync(join(dir, 'afile'), '');
    const r = draw(dir, 'none', ['q', '--out', 'afile/x.svg']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^draw: /);
    assert.doesNotMatch(r.stderr, /\bat .*:\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('draw exits 2 without a question, with an unknown flag, or without Claude Code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  try {
    const noq = spawnSync('node', [cli, 'draw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(noq.status, 2);
    assert.match(noq.stderr, /draw needs a question/);
    const flag = spawnSync('node', [cli, 'draw', 'q', '--nope'], { cwd: dir, encoding: 'utf8' });
    assert.equal(flag.status, 2);
    const missing = spawnSync('node', [cli, 'draw', 'q'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, FLOWFIG_CLAUDE_BIN: join(dir, 'no-such-claude') },
    });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /draw needs Claude Code/);
    assert.doesNotMatch(missing.stderr, /\bat .*:\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('draw --open opens the figure after the report, also with findings; --json sends the line to stderr', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'draw-'));
  try {
    fake(dir);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const login = 1;');
    mkdirSync(join(dir, 'tmp'));
    const go = (mode: string, args: string[]) =>
      spawnSync('node', [cli, 'draw', ...args, '--open'], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          FLOWFIG_CLAUDE_BIN: join(dir, 'claude'),
          FAKE_MODE: mode,
          FAKE_LOG: join(dir, 'argv.log'),
          FLOWFIG_OPENER: 'true',
          TMPDIR: join(dir, 'tmp'),
        },
      });
    const ok = go('ok', ['how does login work?', '--out', 'login.svg']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.endsWith(`${join(dir, 'tmp', 'flowfig-open', 'login.html')} — opened in the default browser\n`), ok.stdout);
    const j = go('ok', ['how does login work?', '--out', 'login2.svg', '--json']);
    assert.equal(JSON.parse(j.stdout).out, 'login2.svg');
    assert.match(j.stderr, /login2\.html — opened in the default browser/);
    const bad = go('bad', ['how does login work?', '--out', 'bad.svg']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /bad\.html — opened in the default browser/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
