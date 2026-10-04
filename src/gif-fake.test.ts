import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

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

const CHROME = `#!/usr/bin/env node
const net = require('node:net');
const zlib = require('node:zlib');
const fs = require('node:fs');
const W = Number(process.env.FAKE_W), H = Number(process.env.FAKE_H), FRAMES = Number(process.env.FAKE_FRAMES);
const input = new net.Socket({ fd: 3, readable: true, writable: false });
const output = new net.Socket({ fd: 4, readable: false, writable: true });
const reply = (o) => output.write(JSON.stringify(o) + '\\0');
const chunk = (kind, body) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]);
};
const png = () => {
  const raw = require('node:crypto').randomBytes(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
let shots = 0, buf = '';
input.on('data', (d) => {
  buf += d;
  for (let end = buf.indexOf('\\0'); end !== -1; end = buf.indexOf('\\0')) {
    const m = JSON.parse(buf.slice(0, end));
    buf = buf.slice(end + 1);
    let result = {};
    if (m.method === 'Target.createTarget') result = { targetId: 't' };
    if (m.method === 'Target.attachToTarget') result = { sessionId: 's' };
    if (m.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'f' } } };
    if (m.method === 'Runtime.evaluate') result = { result: { value: { loop: FRAMES * 20, x: 0, y: 0, width: W, height: H } } };
    if (m.method === 'Page.captureScreenshot') {
      result = { data: png().toString('base64') };
      if (++shots === Number(process.env.FAKE_CRASH_AT)) process.exit(1);
      if (shots === FRAMES) fs.writeFileSync(process.env.FAKE_MARKER, 'x'); // the encode starts now
    }
    reply({ id: m.id, result });
  }
});
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gif-fake-'));
  mkdirSync(join(dir, 'tmp'));
  mkdirSync(join(dir, 'bin'));
  execFileSync(process.execPath, [cli, '-', join(dir, 'fig.svg'), '--no-check'], { input: JSON.stringify(SPEC) });
  writeFileSync(join(dir, 'chrome'), CHROME);
  chmodSync(join(dir, 'chrome'), 0o755);
  return dir;
}
const ffmpeg = (dir: string, body: string) => {
  writeFileSync(join(dir, 'bin', 'ffmpeg'), `#!/bin/sh\n[ "$1" = -version ] && exit 0\n${body}\n`);
  chmodSync(join(dir, 'bin', 'ffmpeg'), 0o755);
};
const env = (dir: string, size: number, extra: NodeJS.ProcessEnv = {}) => ({
  ...process.env,
  CHROME_PATH: join(dir, 'chrome'),
  TMPDIR: join(dir, 'tmp'),
  PATH: join(dir, 'bin') + delimiter + process.env.PATH,
  FAKE_W: String(size),
  FAKE_H: String(size),
  FAKE_FRAMES: '5',
  FAKE_MARKER: join(dir, 'marker'),
  ...extra,
});
const run = (dir: string, args: string[], e: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [cli, 'gif', join(dir, 'fig.svg'), '--fps', '50', '--scale', '1', ...args], { encoding: 'utf8', env: e });
const left = (dir: string) => readdirSync(join(dir, 'tmp')).filter((n) => n.startsWith('flowfig-gif-'));

async function stopAt(dir: string, args: string[], e: NodeJS.ProcessEnv, signal: NodeJS.Signals) {
  const child = spawn(process.execPath, [cli, 'gif', join(dir, 'fig.svg'), '--fps', '50', '--scale', '1', ...args], {
    stdio: 'ignore',
    env: e,
  });
  const exited = new Promise((done) => child.once('exit', (code, sig) => done(code ?? sig)));
  // A loaded machine needs many seconds: wait for the marker or the exit.
  let ended = false;
  void exited.then(() => (ended = true));
  while (!ended && !existsSync(join(dir, 'marker'))) await sleep(25);
  assert.ok(existsSync(join(dir, 'marker')), 'the run ended before the marker');
  await sleep(100);
  child.kill(signal);
  return exited;
}

for (const [signal, exit] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  test(`${signal} during the encode exits ${exit}, with no GIF and no temp folder`, { skip: !posix }, async () => {
    const dir = setup();
    try {
      assert.equal(await stopAt(dir, [], env(dir, 1500), signal), exit);
      assert.equal(existsSync(join(dir, 'fig.gif')), false);
      assert.deepEqual(left(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('SIGINT during ffmpeg stops ffmpeg, exits 130 and leaves no GIF, no MP4 and no temp folder', { skip: !posix }, async () => {
  const dir = setup();
  try {
    ffmpeg(dir, `touch "${join(dir, 'ffmpeg-up')}"\nexec sleep 30`);
    const child = spawn(process.execPath, [cli, 'gif', join(dir, 'fig.svg'), '--fps', '50', '--scale', '1', '--mp4'], {
      stdio: 'ignore',
      env: env(dir, 40),
    });
    const exited = new Promise((done) => child.once('exit', (code, sig) => done(code ?? sig)));
    for (let i = 0; i < 400 && !existsSync(join(dir, 'ffmpeg-up')); i++) await sleep(25);
    assert.ok(existsSync(join(dir, 'ffmpeg-up')), 'ffmpeg did not start');
    child.kill('SIGINT');
    assert.equal(await exited, 130);
    assert.equal(existsSync(join(dir, 'fig.gif')), false);
    assert.equal(existsSync(join(dir, 'fig.mp4')), false);
    assert.deepEqual(left(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ffmpeg that exits 1 gives exit 1 and the message ffmpeg failed', { skip: !posix }, () => {
  const dir = setup();
  try {
    ffmpeg(dir, 'echo boom >&2\nexit 1');
    const r = run(dir, ['--mp4'], env(dir, 40));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /gif: ffmpeg failed: boom/);
    assert.equal(existsSync(join(dir, 'fig.mp4')), false);
    assert.deepEqual(left(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a GIF over 10 MB gives a warning with the size and the way to shrink it', { skip: !posix }, () => {
  const dir = setup();
  try {
    const r = run(dir, [], env(dir, 1500));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /warning: .*fig\.gif is \d+\.\d MB, over 10 MB\. Try --step <n>, a lower --fps or a lower --scale\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a browser that exits during the capture gives exit 1, an error, no GIF and no temp folder', { skip: !posix, timeout: 30000 }, () => {
  const dir = setup();
  try {
    const r = run(dir, [], env(dir, 40, { FAKE_CRASH_AT: '2' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^gif: /);
    assert.equal(existsSync(join(dir, 'fig.gif')), false);
    assert.deepEqual(left(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
