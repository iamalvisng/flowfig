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
    ['--permission-mode', 'dontAsk'],
    ['--allowedTools', 'Read,Glob,Grep,Bash(npx flowfig *)'],
  ])
    assert.equal(a[a.indexOf(pair[0]) + 1], pair[1], pair[0]);
  const sys = a[a.indexOf('--append-system-prompt') + 1];
  assert.ok(sys.startsWith(AGENT_TEXT.split('\n')[0]));
  assert.match(sys, /docs\/x\.svg/);
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
out=$(printf '%s\\n' "$@" | sed -n 's/.*Write the SVG to \\(.*\\) with.*/\\1/p' | head -1)
case "$FAKE_MODE" in
  ok) printf '%s' '${SPEC}' | node "${cli}" - "$out" >/dev/null 2>&1; echo 'warning: something'; echo '{"result":"drawn","total_cost_usd":0.0123,"session_id":"s1"}';;
  none) echo '{"result":"I could not find the flow"}';;
  bad) printf '%s' '${BAD}' | node "${cli}" - "$out" --no-check >/dev/null 2>&1; echo '{"result":"drawn"}';;
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
    const none = draw(dir, 'none', ['q', '--out', 'x.svg']);
    assert.equal(none.status, 1);
    assert.match(none.stdout, /I could not find the flow/);
    assert.match(none.stderr, /wrote no figure at x\.svg/);
    const bad = draw(dir, 'bad', ['q', '--out', 'y.svg']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /unknown-id/);
    const crash = draw(dir, 'crash', ['q', '--out', 'z.svg']);
    assert.equal(crash.status, 1);
    assert.match(crash.stderr, /claude failed \(exit 3\)/);
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
