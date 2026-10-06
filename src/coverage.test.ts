import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageReport } from './coverage.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'cli.js');

const figure = (source: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="figure-spec"><![CDATA[${JSON.stringify({
    props: { layout: { children: [{ id: 'a', label: 'A', source }] }, edges: [] },
  })}]]></metadata></svg>`;

const withRepo = (files: Record<string, string>, run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), text);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const commit = (root: string, paths: string[], date: string) => {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync('git', ['add', ...paths], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', date], { cwd: root, env });
};

test('a commit to a linked file after the figure commit makes the figure stale', () => {
  withRepo({ 'src/login.ts': 'export function login() {}\n', 'docs/login.svg': figure('src/login.ts#login') }, (root) => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    commit(root, ['.'], '2026-09-20T10:00:00Z');
    writeFileSync(join(root, 'src/login.ts'), 'export function login() { return 1; }\n');
    commit(root, ['src/login.ts'], '2026-10-01T10:00:00Z');
    assert.deepEqual(coverageReport({ root }).figures, [
      { figure: 'docs/login.svg', state: 'stale', detail: 'src/login.ts changed 2026-10-01, figure 2026-09-20' },
    ]);
  });
});

test('in a root below the git top folder, an uncommitted change to a linked file makes the figure stale', () => {
  withRepo({ 'pkg/src/login.ts': 'export function login() {}\n', 'pkg/docs/login.svg': figure('src/login.ts#login') }, (top) => {
    execFileSync('git', ['init', '-q'], { cwd: top });
    commit(top, ['.'], '2026-09-20T10:00:00Z');
    writeFileSync(join(top, 'pkg/src/login.ts'), 'export function login() { return 1; }\n');
    assert.deepEqual(coverageReport({ root: join(top, 'pkg') }).figures, [
      { figure: 'docs/login.svg', state: 'stale', detail: 'src/login.ts changed now, figure 2026-09-20' },
    ]);
  });
});

test('a figure with a broken spec is fail, and the other figures still get a state', () => {
  withRepo(
    {
      'src/login.ts': 'export function login() {}\n',
      'docs/bad.svg': '<svg><metadata id="figure-spec"><![CDATA[{ not json ]]></metadata></svg>',
      'docs/login.svg': figure('src/login.ts#login'),
    },
    (root) => {
      assert.deepEqual(
        coverageReport({ root }).figures.map((f) => [f.figure, f.state]),
        [
          ['docs/bad.svg', 'fail'],
          ['docs/login.svg', 'ok'],
        ],
      );
    },
  );
});

test('a figure with a missing symbol is fail, and --strict then exits 1', () => {
  withRepo({ 'src/login.ts': 'export function login() {}\n', 'docs/old.svg': figure('src/login.ts#logout') }, (root) => {
    const plain = spawnSync('node', [cli, 'coverage', '--root', root], { encoding: 'utf8' });
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /^docs\/old\.svg +fail +1 error: missing-symbol$/m);
    assert.equal(spawnSync('node', [cli, 'coverage', '--root', root, '--strict'], { encoding: 'utf8' }).status, 1);
  });
});

test('a code file that no figure links shows in the --entries list', () => {
  withRepo(
    {
      'src/routes/refunds.ts': 'export function refund() {}\n',
      'src/routes/orders.ts': 'export function order() {}\n',
      'src/lib/util.ts': 'export function util() {}\n',
      'docs/orders.svg': figure('src/routes/orders.ts#order'),
    },
    (root) => {
      assert.deepEqual(coverageReport({ root, entries: 'src/routes/**' }).entries, {
        glob: 'src/routes/**',
        total: 2,
        uncovered: ['src/routes/refunds.ts'],
      });
      assert.deepEqual(coverageReport({ root, entries: './src/routes/**' }).entries?.uncovered, ['src/routes/refunds.ts']);
    },
  );
});

test('a linked file that git ignores does not make the figure stale', () => {
  withRepo({ '.gitignore': 'gen/\n', 'gen/api.ts': 'export function api() {}\n', 'docs/gen.svg': figure('gen/api.ts#api') }, (root) => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    commit(root, ['.'], '2026-09-20T10:00:00Z');
    assert.equal(coverageReport({ root }).figures[0].state, 'ok');
  });
});

test('coverage skips test files in the folder counts and the uncovered list', () => {
  const files = { 'src/a.ts': 'export {};\n', 'src/a.test.ts': 'export {};\n', 'pkg/x_test.go': 'package x\n', 'pkg/x.go': 'package x\n' };
  withRepo(files, (root) => {
    assert.deepEqual(coverageReport({ root }).folders, [
      { folder: 'pkg', covered: 0, total: 1 },
      { folder: 'src', covered: 0, total: 1 },
    ]);
    assert.deepEqual(coverageReport({ root, entries: '**/*' }).entries?.uncovered.sort(), ['pkg/x.go', 'src/a.ts']);
    assert.equal(coverageReport({ root, entries: 'src/a.test.ts' }).entries?.total, 1);
  });
});
