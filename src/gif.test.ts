import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('the GIF has the GIF89a header, a 256-color global table and a loop forever block', () => {
  const d = decodeGif(encodeGif([frame(image(4, 3, () => [255, 0, 0]))]));
  assert.equal(d.header, 'GIF89a');
  assert.deepEqual([d.width, d.height], [4, 3]);
  assert.equal(d.tableSize, 256);
  assert.equal(d.loop, 0);
  assert.deepEqual([d.frames[0].delay, d.frames[0].disposal], [5, 1]);
});

test('frames with 3 colors give a palette that holds those 3 exact colors', () => {
  const rgb = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const d = decodeGif(encodeGif([frame(image(3, 1, (x) => rgb[x])), frame(image(3, 1, (x) => rgb[2 - x]))]));
  assert.deepEqual(d.palette.slice(0, 9), rgb.flat());
});

test('a round trip gives back each frame, and a later frame holds only the changed rectangle', () => {
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
  const d = decodeGif(encodeGif([frame(first), frame(second, 7)]));
  assert.equal(d.frames.length, 2);
  assert.deepEqual(d.frames[0].rect, [0, 0, 96, 96]);
  assert.deepEqual(d.frames[1].rect, [10, 20, 3, 2]);
  assert.equal(d.frames[1].delay, 7);
  assert.deepEqual(d.frames[0].rgba, first.data);
  assert.deepEqual(d.frames[1].rgba, second.data);
});

test('a frame with no change is a 1 x 1 image, and the frame count stays the same', () => {
  const img = image(5, 4, (x, y) => [x * 40, y * 40, 0]);
  const d = decodeGif(encodeGif([frame(img), frame(img), frame(img)]));
  assert.equal(d.frames.length, 3);
  assert.deepEqual(d.frames[1].rect, [0, 0, 1, 1]);
  assert.deepEqual(d.frames[2].rgba, img.data);
});

test('300 colors make a 256-color palette, and each pixel stays within 16 per channel', () => {
  // A lattice of 300 colors, one color in each 5-bit bin: more colors than the palette holds.
  const img = image(30, 10, (x, y) => {
    const i = y * 30 + x;
    return [8 * (i % 10) + 4, 8 * (Math.floor(i / 10) % 10) + 4, 8 * Math.floor(i / 100) + 4];
  });
  const d = decodeGif(encodeGif([frame(img)]));
  assert.equal(d.tableSize, 256);
  const out = d.frames[0].rgba;
  for (let i = 0; i < img.data.length; i++) assert.ok(Math.abs(out[i] - img.data[i]) <= 16, `byte ${i}: ${out[i]} vs ${img.data[i]}`);
});

test('a frame with another size throws', () => {
  assert.throws(() => encodeGif([frame(image(2, 2, () => [0, 0, 0])), frame(image(3, 2, () => [0, 0, 0]))]), /frame 2 is 3 x 2/);
});
