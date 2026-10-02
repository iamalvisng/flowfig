import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser } from './browser.ts';
import { delays, encodeGif, type GifFrame } from './gif.ts';
import type { Image } from './png.ts';

/** GIF LZW decode, for the round trip. */
function lzwDecode(data: number[], minSize: number): number[] {
  const clear = 1 << minSize,
    end = clear + 1;
  let size = minSize + 1,
    dict: number[][] = [],
    prev: number[] | null = null,
    acc = 0,
    bits = 0,
    at = 0;
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
    size = minSize + 1;
    prev = null;
  };
  reset();
  const out: number[] = [];
  for (;;) {
    while (bits < size) {
      if (at >= data.length) return out;
      acc |= data[at++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      reset();
      continue;
    }
    if (code === end) return out;
    const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
}

/** A small GIF decoder: the header, the global table, the loop count, and each frame drawn with disposal method 1. */
function decodeGif(bytes: Uint8Array) {
  let at = 6;
  const u8 = () => bytes[at++];
  const u16 = () => bytes[at++] | (bytes[at++] << 8);
  const blocks = () => {
    const out: number[] = [];
    for (let n = u8(); n; n = u8()) {
      out.push(...bytes.subarray(at, at + n));
      at += n;
    }
    return out;
  };
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  const width = u16(),
    height = u16(),
    packed = u8();
  at += 2;
  const tableSize = packed & 0x80 ? 2 << (packed & 7) : 0;
  const palette = [...bytes.subarray(at, at + tableSize * 3)];
  at += tableSize * 3;
  const canvas = new Uint8Array(width * height * 4);
  const frames: { rect: number[]; delay: number; disposal: number; rgba: Uint8Array }[] = [];
  let loop: number | null = null,
    delay = 0,
    disposal = 0;
  for (;;) {
    const kind = u8();
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = u8(),
        data = blocks();
      if (label === 0xf9) [disposal, delay] = [(data[0] >> 2) & 7, data[1] | (data[2] << 8)];
      if (label === 0xff && String.fromCharCode(...data.slice(0, 11)) === 'NETSCAPE2.0') loop = data[12] | (data[13] << 8);
      continue;
    }
    assert.equal(kind, 0x2c, `block at ${at - 1}`);
    const x = u16(),
      y = u16(),
      w = u16(),
      h = u16();
    u8();
    const minSize = u8();
    const indices = lzwDecode(blocks(), minSize);
    assert.equal(indices.length, w * h);
    indices.forEach((k, j) => {
      const p = ((y + Math.floor(j / w)) * width + x + (j % w)) * 4;
      canvas.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], 255], p);
    });
    frames.push({ rect: [x, y, w, h], delay, disposal, rgba: canvas.slice() });
  }
  return { header, width, height, tableSize, palette, loop, frames };
}

const image = (width: number, height: number, color: (x: number, y: number) => number[]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
};
const frame = (img: Image, delay = 5): GifFrame => ({ load: () => img, delay });

test('delays spreads the rounding over the frames', () => {
  assert.deepEqual(delays(6, 30), [3, 4, 3, 3, 4, 3]);
  assert.equal(
    delays(20, 20).reduce((a, b) => a + b, 0),
    100,
  );
});

test('the GIF has the GIF89a header, a 256-color global table and a loop forever block', async () => {
  const d = decodeGif(await encodeGif([frame(image(4, 3, () => [255, 0, 0]))]));
  assert.equal(d.header, 'GIF89a');
  assert.deepEqual([d.width, d.height], [4, 3]);
  assert.equal(d.tableSize, 256);
  assert.equal(d.loop, 0);
  assert.deepEqual([d.frames[0].delay, d.frames[0].disposal], [5, 1]);
});

test('frames with 3 colors give a palette that holds those 3 exact colors', async () => {
  const rgb = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const d = decodeGif(await encodeGif([frame(image(3, 1, (x) => rgb[x])), frame(image(3, 1, (x) => rgb[2 - x]))]));
  assert.deepEqual(d.palette.slice(0, 9), rgb.flat());
});

test('a round trip gives back each frame, and a later frame holds only the changed rectangle', async () => {
  // 96 x 96 pixels of noise in 200 colors: enough LZW codes to fill the table, so the encoder sends a clear code.
  let seed = 1;
  const noise = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 200;
  const colorOf = (n: number) => [n, (n * 7) & 255, (n * 13) & 255];
  const first = image(96, 96, () => colorOf(noise()));
  const second = image(96, 96, () => [0, 0, 0]);
  second.data.set(first.data);
  for (const [x, y] of [
    [10, 20],
    [12, 21],
  ])
    second.data.set([255, 255, 255, 255], (y * 96 + x) * 4);
  const d = decodeGif(await encodeGif([frame(first), frame(second, 7)]));
  assert.equal(d.frames.length, 2);
  assert.deepEqual(d.frames[0].rect, [0, 0, 96, 96]);
  assert.deepEqual(d.frames[1].rect, [10, 20, 3, 2]);
  assert.equal(d.frames[1].delay, 7);
  assert.deepEqual(d.frames[0].rgba, first.data);
  assert.deepEqual(d.frames[1].rgba, second.data);
});

test('a frame with no change is a 1 x 1 image, and the frame count stays the same', async () => {
  const img = image(5, 4, (x, y) => [x * 40, y * 40, 0]);
  const d = decodeGif(await encodeGif([frame(img), frame(img), frame(img)]));
  assert.equal(d.frames.length, 3);
  assert.deepEqual(d.frames[1].rect, [0, 0, 1, 1]);
  assert.deepEqual(d.frames[2].rgba, img.data);
});

test('a same frame is never loaded, and the bytes equal those of a full load (300 colors)', async () => {
  const a = image(30, 10, (x, y) => [
    8 * ((y * 30 + x) % 10) + 4,
    8 * (Math.floor((y * 30 + x) / 10) % 10) + 4,
    8 * Math.floor((y * 30 + x) / 100) + 4,
  ]);
  const b = image(30, 10, (x, y) => [(x * 8) % 256, y * 20, 90]);
  const full = await encodeGif([frame(a), frame(a), frame(a), frame(b), frame(b)]);
  const skip = (): Image => assert.fail('a same frame was loaded');
  const same = await encodeGif([
    frame(a),
    { load: skip, delay: 5, same: true },
    { load: skip, delay: 5, same: true },
    frame(b),
    { load: skip, delay: 5, same: true },
  ]);
  assert.deepEqual(same, full);
});

test('300 colors make a 256-color palette, and each pixel stays within 16 per channel', async () => {
  // A lattice of 300 colors, one color in each 5-bit bin: more colors than the palette holds.
  const img = image(30, 10, (x, y) => {
    const i = y * 30 + x;
    return [8 * (i % 10) + 4, 8 * (Math.floor(i / 10) % 10) + 4, 8 * Math.floor(i / 100) + 4];
  });
  const d = decodeGif(await encodeGif([frame(img)]));
  assert.equal(d.tableSize, 256);
  const out = d.frames[0].rgba;
  for (let i = 0; i < img.data.length; i++) assert.ok(Math.abs(out[i] - img.data[i]) <= 16, `byte ${i}: ${out[i]} vs ${img.data[i]}`);
});

test('a frame with another size throws', async () => {
  await assert.rejects(encodeGif([frame(image(2, 2, () => [0, 0, 0])), frame(image(3, 2, () => [0, 0, 0]))]), /frame 2 is 3 x 2/);
});

// End to end: the CLI with the real capture browser. The tests skip when this machine has none.
const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');
const skip = !findBrowser({ platform: process.platform, env: process.env, exists: existsSync }).path || process.platform === 'win32';
const ONE = {
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
/** The temp folders of earlier gif runs. Another process can make one, so a test compares the list before and after. */
const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('flowfig-gif-'));
const render = (dir: string, name: string, spec: object) => {
  const svg = join(dir, `${name}.svg`);
  execFileSync(process.execPath, [cli, '-', svg, '--no-check'], { input: JSON.stringify(spec) });
  return svg;
};
const gif = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [cli, 'gif', ...args], { encoding: 'utf8', env });

test('gif writes one frame per 1/fps of the loop, prints the line and removes its temp folder', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  const before = leftovers();
  try {
    const svg = render(dir, 'one', ONE);
    const loop = Number(/animation: \S+ ([\d.]+)s infinite/.exec(readFileSync(svg, 'utf8'))![1]);
    const frames = Math.round(loop * 10);
    const r = gif([svg, '--fps', '10', '--scale', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`one\\.gif — ${frames} frames, ${(frames / 10).toFixed(1)} s, [\\d.]+ MB\\n$`));
    assert.equal(decodeGif(readFileSync(join(dir, 'one.gif'))).frames.length, frames);
    assert.deepEqual(leftovers(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gif --dark paints the dark theme; the default is the light theme', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  try {
    const svg = render(dir, 'one', ONE);
    assert.equal(gif([svg, join(dir, 'light.gif'), '--fps', '1', '--scale', '1']).status, 0);
    assert.equal(gif([svg, join(dir, 'dark.gif'), '--fps', '1', '--scale', '1', '--dark']).status, 0);
    // The pixel at (0, 0) is the figure background.
    const corner = (file: string) => [...decodeGif(readFileSync(join(dir, file))).frames[0].rgba.subarray(0, 3)];
    const sum = (c: number[]) => c[0] + c[1] + c[2];
    assert.ok(sum(corner('light.gif')) > sum(corner('dark.gif')) + 300, `${corner('light.gif')} vs ${corner('dark.gif')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a figure with no animation makes one frame', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  try {
    const svg = render(dir, 'still', { props: { layout: { children: [{ id: 'a', label: 'A' }] }, edges: [], steps: [] } });
    const r = gif([svg, '--scale', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /still\.gif — 1 frame, /);
    assert.equal(decodeGif(readFileSync(join(dir, 'still.gif'))).frames.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ctrl-C stops the run, stops the browser and removes the temp folder', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  const before = leftovers();
  try {
    const svg = render(dir, 'one', ONE);
    const child = spawn(process.execPath, [cli, 'gif', svg, '--fps', '50'], { stdio: 'ignore' });
    setTimeout(() => child.kill('SIGINT'), 1500);
    const code = await new Promise((done) => child.once('exit', done));
    // A fast machine can finish before the signal: then the exit is 0 and the GIF is there.
    assert.ok(code === 130 || code === 0, String(code));
    if (code === 130) assert.equal(existsSync(join(dir, 'one.gif')), false);
    assert.deepEqual(leftovers(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A private TMPDIR makes the temp folder and the browser command line belong to this run only.
for (const delay of [50, 300]) {
  test(`Ctrl-C ${delay} ms after the browser start begins leaves no browser and no temp folder`, { skip }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
    const priv = join(dir, 'tmp');
    mkdirSync(priv);
    const left = () => readdirSync(priv).filter((n) => n.startsWith('flowfig-gif-'));
    const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
    const browsers = () => spawnSync('pgrep', ['-f', priv]).status === 0;
    try {
      const svg = render(dir, 'one', ONE);
      const child = spawn(process.execPath, [cli, 'gif', svg, '--fps', '50'], { stdio: 'ignore', env: { ...process.env, TMPDIR: priv } });
      const exited = new Promise((done) => child.once('exit', (code, signal) => done(code ?? signal)));
      // The handler is set in the same tick as the temp folder, so wait for the folder (slow machines start late).
      for (let i = 0; i < 200 && left().length === 0; i++) await sleep(25);
      assert.equal(left().length, 1, 'the run made no temp folder');
      await sleep(delay);
      child.kill('SIGINT');
      assert.equal(await exited, 130);
      assert.equal(existsSync(join(dir, 'one.gif')), false);
      assert.deepEqual(left(), []);
      // The kill of the browser group can take a moment to show.
      for (let i = 0; i < 100 && browsers(); i++) await sleep(50);
      assert.equal(browsers(), false, 'a browser of this run still runs');
    } finally {
      spawnSync('pkill', ['-9', '-f', priv]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('gif --step 1 writes <name>-step1.gif and keeps <name>.gif', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  try {
    const two = { props: { ...ONE.props, steps: [...ONE.props.steps, { label: 'read', flow: [{ edges: 'w', back: true }] }] } };
    const svg = render(dir, 'two', two);
    const r = gif([svg, '--step', '1', '--fps', '5', '--scale', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /two-step1\.gif — /);
    assert.ok(existsSync(join(dir, 'two-step1.gif')));
    assert.equal(existsSync(join(dir, 'two.gif')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gif --mp4 writes the MP4 with ffmpeg, and only the GIF without ffmpeg', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gif-e2e-'));
  try {
    const svg = render(dir, 'one', ONE);
    // An empty PATH hides ffmpeg. The browser path does not use PATH.
    const none = gif([svg, '--fps', '2', '--scale', '1', '--mp4'], { ...process.env, PATH: '' });
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stderr, /gif: no ffmpeg on the PATH, so no MP4\. The GIF is written\./);
    assert.ok(existsSync(join(dir, 'one.gif')));
    assert.equal(existsSync(join(dir, 'one.mp4')), false);
    if (spawnSync('ffmpeg', ['-version']).error) return;
    const r = gif([svg, '--fps', '2', '--scale', '1', '--mp4']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /one\.gif — 7 frames, .*\n.*one\.mp4 — 7 frames, /);
    assert.ok(existsSync(join(dir, 'one.mp4')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
