import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { openerFor, pageName } from './open.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');
const posix = process.platform !== 'win32';
const SPEC = {
  props: {
    layout: {
      children: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'Server' },
      ],
    },
    edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
    steps: [{ label: 'write', flow: [{ edges: 'w' }] }],
  },
};

test('openerFor gives the opener of each system', () => {
  assert.deepEqual(openerFor('darwin', '/t/a.html'), { cmd: 'open', args: ['/t/a.html'], verbatim: false });
  assert.deepEqual(openerFor('linux', '/t/a.html'), { cmd: 'xdg-open', args: ['/t/a.html'], verbatim: false });
  assert.deepEqual(openerFor('win32', 'C:\\t\\a b.html'), { cmd: 'cmd', args: ['/c', 'start', '""', '"C:\\t\\a b.html"'], verbatim: true });
});

test('pageName keeps letters, digits, - and _ only', () => {
  assert.equal(pageName('my figure&v2.svg'), 'my-figure-v2.html');
  assert.equal(pageName(join('docs', 'login_flow.svg')), 'login_flow.html');
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'open-'));
  mkdirSync(join(dir, 'tmp'));
  spawnSync(process.execPath, [cli, '-', join(dir, 'fig.svg')], { input: JSON.stringify(SPEC) });
  // Windows cannot start a shell script, so node is the opener there.
  if (posix) {
    writeFileSync(join(dir, 'opener'), `#!/bin/sh\nprintf '%s' "$1" > "${join(dir, 'opened.log')}"\n`);
    chmodSync(join(dir, 'opener'), 0o755);
  }
  return dir;
}
const open = (dir: string, args: string[], opener = posix ? join(dir, 'opener') : process.execPath) =>
  spawnSync(process.execPath, [cli, 'open', ...args], {
    encoding: 'utf8',
    // Windows reads its temp folder from TEMP and TMP, not TMPDIR.
    env: { ...process.env, TMPDIR: join(dir, 'tmp'), TEMP: join(dir, 'tmp'), TMP: join(dir, 'tmp'), FLOWFIG_OPENER: opener },
  });

test('open writes the page to the temp folder and starts the opener with the page', async () => {
  const dir = setup();
  try {
    const r = open(dir, [join(dir, 'fig.svg'), '--html', join(dir, 'copy.html')]);
    assert.equal(r.status, 0, r.stderr);
    const page = r.stdout.split(' — ')[0];
    assert.equal(dirname(dirname(page)), join(dir, 'tmp'));
    assert.match(dirname(page), /flowfig-open-[^/\\]+$/);
    assert.equal(r.stdout, `${page} — opened in the default browser\n${join(dir, 'copy.html')}\n`);
    assert.ok(readFileSync(page, 'utf8').includes(readFileSync(join(dir, 'fig.svg'), 'utf8')));
    assert.equal(readFileSync(join(dir, 'copy.html'), 'utf8'), readFileSync(page, 'utf8'));
    if (!posix) return;
    // The opener runs after the CLI exits, so wait for its log.
    const log = join(dir, 'opened.log');
    for (let i = 0; i < 100 && !(existsSync(log) && readFileSync(log, 'utf8')); i++) await sleep(50);
    assert.equal(readFileSync(log, 'utf8'), page);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'open does not follow a symlink at the old shared path, and each run uses its own private folder',
  { skip: !posix && 'a symlink needs a privilege on Windows, and Windows has no 0700 mode' },
  () => {
    const dir = setup();
    try {
      const victim = join(dir, 'victim.txt');
      writeFileSync(victim, 'keep');
      mkdirSync(join(dir, 'tmp', 'flowfig-open'));
      symlinkSync(victim, join(dir, 'tmp', 'flowfig-open', 'fig.html'));
      const pages = [1, 2].map(() => {
        const r = open(dir, [join(dir, 'fig.svg')]);
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.split(' — ')[0];
      });
      assert.equal(readFileSync(victim, 'utf8'), 'keep');
      assert.notEqual(dirname(pages[0]), dirname(pages[1]));
      assert.equal(statSync(dirname(pages[0])).mode & 0o777, 0o700);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('open exits 1 and names the page when the opener does not start', () => {
  const dir = setup();
  try {
    const r = open(dir, [join(dir, 'fig.svg')], join(dir, 'no-such-opener'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^open: .*ENOENT.*\. Open .*fig\.html in a browser\.\n$/);
    const [folder] = readdirSync(join(dir, 'tmp'));
    assert.ok(existsSync(join(dir, 'tmp', folder, 'fig.html')), 'the page stays for the user');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open exits 2 for bad use', () => {
  const dir = setup();
  try {
    const cases: [string[], RegExp][] = [
      [[], /usage: flowfig open/],
      [['fig.txt'], /fig\.txt: expected a \.svg path/],
      [[join(dir, 'missing.svg')], /missing\.svg: ENOENT/],
      [[join(dir, 'fig.svg'), '--html'], /--html needs a path/],
      [[join(dir, 'fig.svg'), '--wide'], /unknown flag --wide/],
    ];
    for (const [args, message] of cases) {
      const r = open(dir, args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr, message);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
