import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePng } from './png.ts';

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function png(width: number, height: number, type: number, pixels: number[], filters: number[], depth = 8): Buffer {
  const bpp = type === 6 ? 4 : 3,
    stride = width * bpp;
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(filters[y]);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= bpp ? pixels[at - bpp] : 0,
        b = y ? pixels[at - stride] : 0,
        c = x >= bpp && y ? pixels[at - stride - bpp] : 0;
      raw.push((pixels[at] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][filters[y]]) & 255);
    }
  }
  const chunk = (kind: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  const z = deflateSync(Buffer.from(raw));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, 5)),
    chunk('IDAT', z.subarray(5)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FILTERS = [0, 1, 2, 3, 4];

test('decodePng reverses the five row filters of an RGBA PNG', () => {
  const pixels = Array.from({ length: 3 * 5 * 4 }, (_, i) => (i * 37 + 11) & 255);
  const img = decodePng(png(3, 5, 6, pixels, FILTERS));
  assert.equal(img.width, 3);
  assert.equal(img.height, 5);
  assert.deepEqual([...img.data], pixels);
});

test('decodePng gives alpha 255 to an RGB PNG', () => {
  const pixels = Array.from({ length: 3 * 5 * 3 }, (_, i) => (i * 53 + 7) & 255);
  const rgba = pixels.flatMap((v, i) => (i % 3 === 2 ? [v, 255] : [v]));
  assert.deepEqual([...decodePng(png(3, 5, 2, pixels, FILTERS)).data], rgba);
});

test('the PNG decoder rejects a PNG it cannot read', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG: bad signature/);
  assert.throws(() => decodePng(png(1, 1, 6, [0, 0, 0, 0], [0], 16)), /unsupported PNG: bit depth 16/);
  assert.throws(() => decodePng(png(1, 1, 3, [0, 0, 0], [0])), /unsupported PNG: color type 3/);
  const ok = png(1, 1, 6, [1, 2, 3, 4], [0]);
  const interlaced = Buffer.from(ok);
  interlaced[28] = 1;
  assert.throws(() => decodePng(interlaced), /unsupported PNG: interlace 1/);
  const none = Buffer.concat([ok.subarray(0, 8), Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])]);
  assert.throws(() => decodePng(none), /not a PNG: no IHDR chunk/);
  const tall = Buffer.from(ok);
  tall.writeUInt32BE(5, 20);
  assert.throws(() => decodePng(tall), /not a PNG: the image data is too short/);
});
