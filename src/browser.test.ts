import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFrames, findBrowser, launch, type Cdp } from './browser.ts';

const posix = process.platform !== 'win32';

const FAKE = `#!/usr/bin/env node
const net = require('node:net');
require('node:fs').writeFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)));
const input = new net.Socket({ fd: 3, readable: true, writable: false });
const output = new net.Socket({ fd: 4, readable: false, writable: true });
const reply = (o) => output.write(JSON.stringify(o) + '\\0');
let buf = '';
input.on('data', (d) => {
  buf += d;
  for (let end = buf.indexOf('\\0'); end !== -1; end = buf.indexOf('\\0')) {
    const m = JSON.parse(buf.slice(0, end));
    buf = buf.slice(end + 1);
    if (m.method === 'Browser.getVersion') reply({ id: m.id, result: { product: 'Fake/1' } });
    if (m.method === 'Echo') {
      reply({ method: 'Fake.event', params: { n: 1 }, sessionId: m.sessionId });
      reply({ id: m.id, result: m.params });
    }
    if (m.method === 'Fail') reply({ id: m.id, error: { message: 'no such thing' } });
    if (m.method === 'Die') {
      process.stderr.write('fake crash');
      process.exit(3);
    }
  }
});
`;

function fake(script = FAKE) {
  const dir = mkdtempSync(join(tmpdir(), 'browser-'));
  writeFileSync(join(dir, 'chrome'), script);
  chmodSync(join(dir, 'chrome'), 0o755);
  process.env.FAKE_LOG = join(dir, 'argv.json');
  return dir;
}

const has =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);
const MAC = (n: string) => `/Applications/${n}.app/Contents/MacOS/${n}`;
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/usr/bin/brave-browser',
  '/opt/google/chrome/chrome',
];
const WIN_ENV = {
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
};

test('the browser search takes the first installed browser and lists only the paths before it', () => {
  const r = findBrowser({ platform: 'darwin', env: {}, exists: has(MAC('Chromium')) });
  assert.equal(r.path, MAC('Chromium'));
  assert.deepEqual(r.checked, [MAC('Google Chrome'), MAC('Microsoft Edge'), MAC('Chromium')]);
  const l = findBrowser({ platform: 'linux', env: {}, exists: has('/usr/bin/chromium', '/opt/google/chrome/chrome') });
  assert.equal(l.path, '/usr/bin/chromium');
  assert.deepEqual(l.checked, LINUX.slice(0, 3));
});

test('on Windows the browser search joins each set program folder with backslashes', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const r = findBrowser({ platform: 'win32', env: WIN_ENV, exists: has(edge) });
  assert.equal(r.path, edge);
  assert.equal(r.checked.length, 6);
  assert.equal(r.checked[0], 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findBrowser({ platform: 'win32', env: { LOCALAPPDATA: 'D:\\L' }, exists: has() }).checked.length, 4);
});

test('CHROME_PATH wins over a standard path, and a missing CHROME_PATH is the only path checked', () => {
  const all = () => true;
  assert.deepEqual(findBrowser({ platform: 'darwin', env: { CHROME_PATH: '/opt/x/chrome' }, exists: all }), {
    path: '/opt/x/chrome',
    checked: ['/opt/x/chrome'],
  });
  assert.deepEqual(findBrowser({ platform: 'linux', env: { CHROME_PATH: '/opt/x/chrome' }, exists: has(...LINUX) }), {
    path: null,
    checked: ['/opt/x/chrome'],
  });
});

test('the browser starts headless with a private profile and is ready after Browser.getVersion', { skip: !posix }, async () => {
  const dir = fake();
  try {
    const { close } = await launch(join(dir, 'chrome'), join(dir, 'profile'));
    const argv = JSON.parse(readFileSync(join(dir, 'argv.json'), 'utf8'));
    for (const a of [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-first-run',
      '--hide-scrollbars',
    ])
      assert.ok(argv.includes(a), a);
    assert.equal(argv.at(-1), 'about:blank');
    await close();
    await close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CDP reply settles its own command, an error reply rejects, an event goes to its session', { skip: !posix }, async () => {
  const dir = fake();
  const { cdp, close } = await launch(join(dir, 'chrome'), join(dir, 'profile'));
  try {
    const event = cdp.once('Fake.event', 's1');
    assert.deepEqual(await cdp.send('Echo', { a: 1 }, 's1'), { a: 1 });
    assert.deepEqual(await event, { n: 1 });
    await assert.rejects(cdp.send('Fail'), /^Error: Fail: no such thing$/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a command with no reply rejects after the timeout', { skip: !posix }, async () => {
  const dir = fake();
  // A loaded machine starts the fake browser slowly: keep the launch timeout long.
  const { cdp, close } = await launch(join(dir, 'chrome'), join(dir, 'profile'), 10_000);
  try {
    await assert.rejects(cdp.send('Silent', {}, undefined, 300), /Silent: no reply in 0.3 s/);
    await assert.rejects(cdp.once('Never.event', undefined, 300), /Never.event: no reply in 0.3 s/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when the browser stops, each open command rejects with the exit code and the stderr tail', { skip: !posix }, async () => {
  const dir = fake();
  const { cdp, close } = await launch(join(dir, 'chrome'), join(dir, 'profile'));
  try {
    await assert.rejects(cdp.send('Die'), /the browser stopped \(exit 3\): fake crash/);
    await assert.rejects(cdp.send('Echo'), /the browser stopped \(exit 3\)/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launch rejects when the browser exits at the start', { skip: !posix }, async () => {
  const dir = fake('#!/bin/sh\necho "bad flag" >&2\nexit 1\n');
  try {
    await assert.rejects(launch(join(dir, 'chrome'), join(dir, 'profile')), /the browser stopped \(exit 1\): bad flag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frames from parallel tabs come back in time order', { skip: cpus().length < 2 && 'one core gives one tab' }, async () => {
  const seek = new Map<string | undefined, number>();
  let targets = 0;
  const cdp: Cdp = {
    once: async () => ({}),
    send: async (method, params: any = {}, sessionId) => {
      await new Promise((done) => setTimeout(done, Math.random() * 5));
      if (method === 'Target.createTarget') return { targetId: `t${targets++}` };
      if (method === 'Target.attachToTarget') return { sessionId: `s${params.targetId}` };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f' } } };
      if (method === 'Runtime.evaluate') {
        const t = /currentTime = ([\d.]+)/.exec(params.expression);
        if (!t) return { result: { value: { loop: 1000, x: 0, y: 0, width: 10, height: 10 } } };
        seek.set(sessionId, Number(t[1]));
        return { result: { value: undefined } };
      }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from(String(seek.get(sessionId))).toString('base64') };
      return {};
    },
  };
  const { pngs } = await captureFrames(cdp, '', { width: 10, height: 10, scale: 1, fps: 40, dark: false });
  assert.deepEqual(
    pngs.map((p) => Number(p.toString())),
    Array.from({ length: 40 }, (_, i) => i * 25),
  );
});
