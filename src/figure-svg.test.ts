import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE } from './guide.ts';

// The CLI is how a figure actually gets made, and its promise is that a spec never has to be kept:
// it goes in on stdin and comes back out of the SVG.
const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');
const SPEC = {
  props: {
    layout: {
      children: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'Server', shape: 'store' },
      ],
    },
    edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
    steps: [{ label: 'write', flow: [{ edges: 'w', say: 'The client writes a row.' }] }],
  },
};

test('a spec piped in comes back out of the rendered SVG', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  const out = join(dir, 'out.svg');
  try {
    execFileSync('node', [cli, '-', out], { input: JSON.stringify(SPEC) });
    const svg = readFileSync(out, 'utf8');
    assert.match(svg, /<svg /);
    assert.match(svg, /Client/);
    assert.deepEqual(JSON.parse(execFileSync('node', [cli, '--spec', out], { encoding: 'utf8' })), SPEC);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const run = (args: string[], input?: string) => spawnSync('node', [cli, ...args], { input, encoding: 'utf8' });
const BAD = { props: { ...SPEC.props, edges: [{ id: 'w', from: 'a', to: 'zzz', label: 'write' }] } };

test('check passes a good spec and fails a bad one', () => {
  const good = run(['check', '-'], JSON.stringify(SPEC));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /0 errors/);
  const bad = run(['check', '-'], JSON.stringify(BAD));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /unknown-id/);
});

test('check --json prints only the findings', () => {
  const r = run(['check', '-', '--json'], JSON.stringify(BAD));
  const findings = JSON.parse(r.stdout);
  assert.equal(findings[0].rule, 'unknown-id');
  assert.equal(findings[0].severity, 'error');
});

test('a render with an error writes no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const out = join(dir, 'out.svg');
    assert.equal(run(['-', out], JSON.stringify(BAD)).status, 1);
    assert.ok(!existsSync(out));
    assert.equal(run(['-', out, '--no-check'], JSON.stringify(BAD)).status, 0);
    assert.ok(existsSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check reads the spec back out of an SVG, and says so when there is none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const out = join(dir, 'out.svg');
    execFileSync('node', [cli, '-', out], { input: JSON.stringify(SPEC) });
    assert.equal(run(['check', out]).status, 0);
    const plain = join(dir, 'plain.svg');
    writeFileSync(plain, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const r = run(['check', plain]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no figure spec/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bad use exits with 2', () => {
  assert.equal(run(['check']).status, 2);
  assert.equal(run(['check', '-'], '{ not json').status, 2);
});

test('the repo wrapper keeps a flag after a figure name as a flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const r = spawnSync('node', [cli, 'cached-request', '--no-check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'cached-request.svg')));
    assert.equal(run(['check', 'cached-request', '--strict']).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('docs prints the guide', () => {
  const r = run(['docs']);
  assert.equal(r.status, 0);
  for (const w of ['rail', 'layout', 'edges', 'steps', 'npx flowfig check']) assert.ok(r.stdout.includes(w), w);
  assert.equal(r.stdout, GUIDE.endsWith('\n') ? GUIDE : GUIDE + '\n');
});

test('the example in GUIDE passes check --strict', () => {
  const block = GUIDE.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.ok(block);
  const r = run(['check', '-', '--strict'], block);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a clean render prints the counts on stderr, so the reply can copy them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const r = spawnSync('node', [cli, '-', 'out.svg'], { input: JSON.stringify(SPEC), cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^0 errors, 0 warnings\nfigure: /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('$ patterns in a label or hop data survive the saved spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  const out = join(dir, 'out.svg');
  const spec = {
    props: {
      ...SPEC.props,
      edges: [{ id: 'w', from: 'a', to: 'b', label: 'WHERE email = $1' }],
      steps: [{ label: 'write', flow: [{ edges: [{ edge: 'w', data: 'cost $& $$ total' }] }] }],
    },
  };
  try {
    execFileSync('node', [cli, '-', out], { input: JSON.stringify(spec) });
    assert.deepEqual(JSON.parse(execFileSync('node', [cli, '--spec', out], { encoding: 'utf8' })), spec);
    assert.equal(run(['check', out]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check prints the figure counts, and --json keeps the findings array', () => {
  const spec = {
    props: {
      layout: {
        children: [
          { id: 'a', label: 'A' },
          {
            label: 'Group',
            children: [
              { id: 'b', label: 'B' },
              { id: 'c', label: 'C' },
            ],
          },
        ],
      },
      edges: [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'bc', from: 'b', to: 'c' },
      ],
      steps: [
        { label: 'one', flow: [{ edges: ['ab', 'bc'] }] },
        { label: 'two', flow: [{ edges: 'ab' }] },
      ],
    },
  };
  const line = 'figure: 3 boxes, 1 group, 2 edges, 2 steps, 3 messages';
  const r = run(['check', '-'], JSON.stringify(spec));
  assert.ok(r.stdout.split('\n').includes(line), r.stdout);
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const out = join(dir, 'out.svg');
    const rr = run(['-', out], JSON.stringify(spec));
    assert.ok(rr.stderr.split('\n').includes(line), rr.stderr);
    assert.doesNotMatch(rr.stdout, /figure:/);
  } finally {
    rmSync(dir, { recursive: true });
  }
  assert.ok(Array.isArray(JSON.parse(run(['check', '-', '--json'], JSON.stringify(spec)).stdout)));
});

// Bad use is exit 2 with a message, never a stack trace and never exit 1 (that code means "errors found").
const bad = (args: string[], input = JSON.stringify(SPEC)) => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const r = spawnSync('node', [cli, ...args], { input, cwd: dir, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, files: existsSync(join(dir, '--stric')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('help, --help and -h print the usage and exit 0; no argument prints it and exits 2', () => {
  for (const a of ['help', '--help', '-h']) {
    const r = run([a]);
    assert.equal(r.status, 0, a);
    assert.match(r.stdout, /usage: flowfig/);
    assert.match(r.stdout, /--strict/);
  }
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: flowfig/);
});

test('--spec on a missing file exits 2 with a message, not a stack trace', () => {
  const r = bad(['--spec', 'missing.svg']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing.svg: ENOENT/);
  assert.doesNotMatch(r.stderr, /\bat .*:\d+/);
});

test('--width and --min-text need a positive number, or the CLI exits 2', () => {
  for (const args of [['--width'], ['--width', 'x'], ['--min-text'], ['--min-text', '0'], ['--width', '--json']]) {
    const r = bad(['check', '-', ...args]);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /needs a positive number/);
    assert.doesNotMatch(r.stderr, /\bat .*:\d+/);
  }
  assert.equal(bad(['check', '-', '--width', '900', '--min-text', '9']).status, 0);
});

test('an unknown flag exits 2 and writes no file; a lone - stays the stdin input', () => {
  const r = bad(['-', '--stric']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag --stric/);
  assert.equal(r.files, false);
  assert.equal(bad(['check', '-', '--stric']).status, 2);
  assert.equal(bad(['check', '-']).status, 0);
});

test('a spec with no edges, a step with no flow, a null spec, or --spec with no path exits 2', () => {
  const noEdges = { props: { ...SPEC.props, edges: undefined } };
  const noFlow = { props: { ...SPEC.props, steps: [{ label: 'x' }] } };
  for (const [name, spec] of [
    ['no edges', noEdges],
    ['no flow', noFlow],
    ['null', null],
  ] as const) {
    const r = bad(['check', '-'], JSON.stringify(spec));
    assert.equal(r.status, 2, name);
    assert.doesNotMatch(r.stderr, /\bat .*:\d+/, name);
  }
  const r = bad(['--spec']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--spec needs/);
});
