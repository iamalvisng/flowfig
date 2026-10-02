import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_TEXT, GUIDE } from './guide.ts';

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

test('verify checks the links of one or more figures against --root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'export const login = 1;');
    const linked = { props: { ...SPEC.props, edges: [{ id: 'w', from: 'a', to: 'b', label: 'write', source: 'a.ts#login' }] } };
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(linked));
    const stale = { props: { ...SPEC.props, edges: [{ id: 'w', from: 'a', to: 'b', label: 'write', source: 'a.ts#logout' }] } };
    writeFileSync(join(dir, 'stale.json'), JSON.stringify(stale));
    const ok = run(['verify', join(dir, 'ok.json'), '--root', dir]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /0 errors, 0 warnings/);
    const both = run(['verify', join(dir, 'ok.json'), join(dir, 'stale.json'), '--root', dir, '--json']);
    assert.equal(both.status, 1);
    const j = JSON.parse(both.stdout);
    assert.deepEqual(
      j.findings.map((f: { rule: string; figure: string }) => [f.rule, f.figure.endsWith('stale.json')]),
      [['missing-symbol', true]],
    );
    assert.equal(j.links.length, 2);
    const none = run(['verify', '-', '--root', dir], JSON.stringify(SPEC));
    assert.equal(none.status, 0);
    assert.match(none.stdout, /no-source/);
    assert.equal(run(['verify', '-', '--root', dir, '--strict'], JSON.stringify(SPEC)).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify reads the source of a spec back out of a rendered SVG', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'export const login = 1;');
    const linked = { props: { ...SPEC.props, edges: [{ id: 'w', from: 'a', to: 'b', label: 'write', source: 'a.ts#login' }] } };
    const out = join(dir, 'out.svg');
    execFileSync('node', [cli, '-', out], { input: JSON.stringify(linked) });
    const ok = run(['verify', out, '--root', dir, '--json']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(JSON.parse(ok.stdout).links.length, 1);
    rmSync(join(dir, 'a.ts'));
    assert.equal(run(['verify', out, '--root', dir]).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the browser entries import no Node built-in', () => {
  const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /from ['"]node:/, file);
    for (const m of text.matchAll(/from ['"](\.[^'"]+)['"]/g)) walk(join(dirname(file), m[1]));
  };
  walk(join(dist, 'svg.js'));
  walk(join(dist, 'index.js'));
  assert.ok(seen.size > 3);
});

test('verify on an SVG with no spec exits 2 with a message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    writeFileSync(join(dir, 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r = run(['verify', join(dir, 'plain.svg')]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no figure spec/);
    assert.doesNotMatch(r.stderr, /\bat .*:\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diff prints the spec changes between two figures, as text, Markdown or JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const next = { props: { ...SPEC.props, edges: [{ id: 'w', from: 'a', to: 'b', label: 'read' }] } };
    writeFileSync(join(dir, 'old.json'), JSON.stringify(SPEC));
    writeFileSync(join(dir, 'new.json'), JSON.stringify(next));
    execFileSync('node', [cli, join(dir, 'new.json'), join(dir, 'new.svg')]);
    const text = run(['diff', join(dir, 'old.json'), join(dir, 'new.svg')]);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(text.stdout.trim(), 'edge changed: w (label "write" -> "read")');
    const md = run(['diff', join(dir, 'old.json'), join(dir, 'new.json'), '--md']);
    assert.equal(md.stdout.trim(), '- edge changed: `w` (label "write" -> "read")');
    const json = run(['diff', join(dir, 'old.json'), join(dir, 'new.json'), '--json']);
    assert.equal(JSON.parse(json.stdout)[0].kind, 'edge');
    assert.equal(run(['diff', join(dir, 'old.json'), join(dir, 'old.json')]).stdout.trim(), 'no change in the spec');
    assert.equal(run(['diff', join(dir, 'old.json')]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify passes on the refund process demo against its SOP', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const r = spawnSync('node', [cli, 'verify', 'docs/refund-process.svg'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 errors/);
});

test('verify passes on the roadmap demo against its plan document', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const r = spawnSync('node', [cli, 'verify', 'docs/roadmap.svg'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 errors/);
});

test('a render with --open opens the SVG; check --open and a failed render open nothing', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    mkdirSync(join(dir, 'tmp'));
    // `true` stands in for the system opener: it starts, exits 0, and opens nothing.
    const env = { ...process.env, TMPDIR: join(dir, 'tmp'), FLOWFIG_OPENER: 'true' };
    const go = (args: string[], spec: unknown) =>
      spawnSync(process.execPath, [cli, ...args], { input: JSON.stringify(spec), encoding: 'utf8', env });
    const out = join(dir, 'out.svg');
    const r = go(['-', out, '--open'], SPEC);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith(`${out} — `));
    assert.match(lines[1], /flowfig-open-[^/\\]+[/\\]out\.html — opened in the default browser$/);
    const c = go(['check', '-', '--open'], SPEC);
    assert.equal(c.status, 2);
    assert.match(c.stderr, /--open works with a render, not with check/);
    const pages = () => readdirSync(join(dir, 'tmp')).filter((n) => n.startsWith('flowfig-open-'));
    assert.equal(pages().length, 1);
    assert.equal(go(['-', join(dir, 'bad.svg'), '--open'], BAD).status, 1);
    assert.equal(pages().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gif exits 2 for bad use, before a browser starts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figure-svg-'));
  try {
    const one = join(dir, 'one.svg'),
      none = join(dir, 'none.svg'),
      plain = join(dir, 'plain.svg');
    execFileSync('node', [cli, '-', one], { input: JSON.stringify(SPEC) });
    execFileSync('node', [cli, '-', none, '--no-check'], { input: JSON.stringify({ props: { ...SPEC.props, steps: [] } }) });
    writeFileSync(plain, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    // A missing CHROME_PATH: the run can never reach a real browser.
    const env = { ...process.env, CHROME_PATH: join(dir, 'no-such-chrome') };
    const cases: [string[], RegExp][] = [
      [[], /usage: flowfig gif/],
      [['x.txt'], /x\.txt: expected a \.svg path/],
      [[join(dir, 'missing.svg')], /missing\.svg: ENOENT/],
      [[one, '--loop'], /unknown flag --loop/],
      [[one, '--fps', '60'], /--fps needs a whole number from 1 to 50/],
      [[one, '--fps', '2.5'], /--fps needs a whole number from 1 to 50/],
      [[one, '--scale', '0'], /--scale needs a positive number/],
      [[one, '--step', '9'], /--step needs a whole number from 1 to 1/],
      [[one, '--step', '1.5'], /--step needs a whole number from 1 to 1/],
      [[none, '--step', '1'], /none\.svg: --step needs a figure with steps; this figure has 0/],
      [[plain, '--step', '1'], /plain\.svg: no figure spec inside this SVG/],
      [[plain], /plain\.svg: no width and height on the <svg> element/],
      [[one, join(dir, 'no', 'such', 'out.gif')], /out\.gif: the folder does not exist/],
      [[one], /gif needs Chrome, Edge, Chromium or Brave\. Checked:\n.*no-such-chrome\nSet CHROME_PATH to the browser program\./],
    ];
    for (const [args, message] of cases) {
      const r = spawnSync('node', [cli, 'gif', ...args], { encoding: 'utf8', env });
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, message);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the guide and the agent text end the reply with npx flowfig open, and the guide lists open and gif', () => {
  const sentence = 'one line `npx flowfig open <path>` for each SVG';
  assert.ok(AGENT_TEXT.includes(`End the reply with ${sentence}. Do not run that command yourself.`));
  assert.ok(GUIDE.includes(`6. ${sentence}, at the end of the reply. Do not run that command yourself.`));
  assert.match(GUIDE, /\nnpx flowfig open out\.svg +# /);
  assert.match(GUIDE, /\nnpx flowfig gif out\.svg \[out\.gif\] +# /);
});
