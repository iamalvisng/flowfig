import type { Image } from './png.ts';

/** One frame. `load` returns the pixels, `delay` is in cs, `same` skips `load`. */
export type GifFrame = { load: () => Image; delay: number; same?: boolean };

/** The delay of each of `count` frames in cs. The sum is round(count * 100 / fps). */
export function delays(count: number, fps: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps));
}

const binOf = (rgb: number) => ((rgb >> 9) & 0x7c00) | ((rgb >> 6) & 0x3e0) | ((rgb >> 3) & 0x1f);
// Little-endian: a pixel word is A B G R, so this swaps R and B.
const rgbOf = (v: number) => ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255);
const CROP_LIMIT = 64 << 20;

type Crop = { x0: number; y0: number; x1: number; y1: number; px: Uint32Array };

function changedBox(a: Uint32Array, b: Uint32Array, width: number, height: number): [number, number, number, number] | null {
  let x0 = width,
    x1 = -1,
    y0 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    const o = y * width;
    let lo = 0;
    while (lo < width && a[o + lo] === b[o + lo]) lo++;
    if (lo === width) continue;
    let hi = width - 1;
    while (a[o + hi] === b[o + hi]) hi--;
    if (lo < x0) x0 = lo;
    if (hi > x1) x1 = hi;
    if (y0 < 0) y0 = y;
    y1 = y;
  }
  return y1 < 0 ? null : [x0, y0, x1, y1];
}

const channel = (bin: number, c: number) => (bin >> (10 - 5 * c)) & 31;

function cropOf(px: Uint32Array, [x0, y0, x1, y1]: number[], width: number): Uint32Array {
  const w = x1 - x0 + 1,
    out = new Uint32Array(w * (y1 - y0 + 1));
  for (let y = y0; y <= y1; y++) out.set(px.subarray(y * width + x0, y * width + x1 + 1), (y - y0) * w);
  return out;
}

function medianCut(bins: number[], counts: Uint32Array): number[][] {
  const boxes = [bins];
  while (boxes.length < 256) {
    let pick = -1,
      widest = 0,
      axis = 0;
    boxes.forEach((box, i) => {
      for (let c = 0; c < 3; c++) {
        let lo = 31,
          hi = 0;
        for (const b of box) {
          const v = channel(b, c);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > widest) [widest, pick, axis] = [hi - lo, i, c];
      }
    });
    if (pick === -1) break;
    const box = boxes[pick].sort((a, b) => channel(a, axis) - channel(b, axis));
    const half = box.reduce((s, b) => s + counts[b], 0) / 2;
    let at = 1,
      seen = counts[box[0]];
    while (at < box.length - 1 && seen + counts[box[at]] <= half) seen += counts[box[at++]];
    boxes.splice(pick, 1, box.slice(0, at), box.slice(at));
  }
  return boxes;
}

function palette(exact: Map<number, number> | null, counts: Uint32Array, sums: Float64Array) {
  const colors = new Uint8Array(768);
  if (exact) {
    for (const [rgb, k] of exact) colors.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255], k * 3);
    return { colors, index: (rgb: number) => exact.get(rgb)! };
  }
  const bins: number[] = [];
  for (let b = 0; b < 32768; b++) if (counts[b]) bins.push(b);
  const boxes = medianCut(bins, counts);
  boxes.forEach((box, k) => {
    let n = 0,
      r = 0,
      g = 0,
      b = 0;
    for (const x of box) {
      n += counts[x];
      r += sums[x * 3];
      g += sums[x * 3 + 1];
      b += sums[x * 3 + 2];
    }
    colors.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], k * 3);
  });
  const table = new Uint8Array(32768);
  for (const x of bins) {
    const r = sums[x * 3] / counts[x],
      g = sums[x * 3 + 1] / counts[x],
      b = sums[x * 3 + 2] / counts[x];
    let best = 0,
      dist = Infinity;
    for (let k = 0; k < boxes.length; k++) {
      const d = (colors[k * 3] - r) ** 2 + (colors[k * 3 + 1] - g) ** 2 + (colors[k * 3 + 2] - b) ** 2;
      if (d < dist) [dist, best] = [d, k];
    }
    table[x] = best;
  }
  return { colors, index: (rgb: number) => table[binOf(rgb)] };
}

function lzw(px: Uint8Array, width: number, rect: number[], byte: (v: number) => void): void {
  const [x0, y0, x1, y1] = rect;
  const CLEAR = 256,
    END = 257;
  const block = new Uint8Array(255);
  const dict = new Map<number, number>();
  let blen = 0,
    acc = 0,
    bits = 0,
    size = 9,
    next = 258,
    prefix = -1;
  const flush = () => {
    byte(blen);
    for (let i = 0; i < blen; i++) byte(block[i]);
    blen = 0;
  };
  const emit = (code: number) => {
    acc |= code << bits;
    for (bits += size; bits >= 8; bits -= 8, acc >>>= 8) {
      block[blen++] = acc & 255;
      if (blen === 255) flush();
    }
  };
  byte(8);
  emit(CLEAR);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = px[y * width + x];
      if (prefix < 0) {
        prefix = k;
        continue;
      }
      const code = dict.get((prefix << 8) | k);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(CLEAR);
        dict.clear();
        [next, size] = [258, 9];
      } else {
        // The decoder runs one code behind: grow the size one code early.
        if (next >= 1 << size) size++;
        dict.set((prefix << 8) | k, next++);
      }
      prefix = k;
    }
  emit(prefix);
  emit(END);
  if (bits > 0) {
    block[blen++] = acc & 255;
    if (blen === 255) flush();
  }
  if (blen) flush();
  byte(0);
}

/** An animated GIF that loops forever. All frames have the size of the first frame. */
// It yields between frames so a signal handler can run.
export async function encodeGif(frames: GifFrame[]): Promise<Uint8Array> {
  if (!frames.length) throw new Error('a GIF needs at least one frame');
  const counts = new Uint32Array(32768),
    sums = new Float64Array(32768 * 3);
  let exact: Map<number, number> | null = new Map(),
    width = 0,
    height = 0;
  let before: Uint32Array | null = null,
    kept = 0;
  const crops: (Crop | null | undefined)[] = [];
  for (let f = 0; f < frames.length; f++) {
    if (frames[f].same && f > 0) continue;
    let weight = 1;
    while (f + weight < frames.length && frames[f + weight].same) weight++;
    await new Promise(setImmediate);
    const { width: w, height: h, data } = frames[f].load();
    if (f === 0) [width, height] = [w, h];
    else if (w !== width || h !== height) throw new Error(`frame ${f + 1} is ${w} x ${h}; the first frame is ${width} x ${height}`);
    const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    let last = px[0] & 0xffffff,
      run = 0;
    const add = (v: number, n: number) => {
      const rgb = rgbOf(v),
        bin = binOf(rgb),
        k = n * weight;
      if (exact && !exact.has(rgb)) exact = exact.size < 256 ? exact.set(rgb, exact.size) : null;
      counts[bin] += k;
      sums[bin * 3] += (rgb >> 16) * k;
      sums[bin * 3 + 1] += ((rgb >> 8) & 255) * k;
      sums[bin * 3 + 2] += (rgb & 255) * k;
    };
    for (let i = 0; i < px.length; i++) {
      const v = px[i] & 0xffffff;
      if (v === last) run++;
      else {
        add(last, run);
        [last, run] = [v, 1];
      }
    }
    add(last, run);
    const box = before ? changedBox(px, before, width, height) : [0, 0, width - 1, height - 1];
    if (!box) crops[f] = null;
    else {
      const [x0, y0, x1, y1] = box;
      const size = (x1 - x0 + 1) * (y1 - y0 + 1) * 4;
      if (kept + size <= CROP_LIMIT) {
        kept += size;
        crops[f] = { x0, y0, x1, y1, px: before ? cropOf(px, box, width) : px };
      }
    }
    before = px;
  }
  const { colors, index } = palette(exact, counts, sums);

  let buf = new Uint8Array(1 << 20),
    len = 0;
  const byte = (v: number) => {
    if (len === buf.length) {
      const grown = new Uint8Array(buf.length * 2);
      grown.set(buf);
      buf = grown;
    }
    buf[len++] = v;
  };
  const word = (v: number) => {
    byte(v & 255);
    byte(v >> 8);
  };
  const bytes = (...vs: number[]) => vs.forEach(byte);
  const text = (s: string) => {
    for (const c of s) byte(c.charCodeAt(0));
  };
  text('GIF89a');
  word(width);
  word(height);
  bytes(0xf7, 0, 0); // a global color table of 256 colors; background color 0; no aspect ratio
  colors.forEach(byte);
  bytes(0x21, 0xff, 11);
  text('NETSCAPE2.0');
  bytes(3, 1, 0, 0, 0); // loop count 0: loop forever

  let prev: Uint8Array | null = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i],
      crop = crops[i];
    await new Promise(setImmediate);
    let cur: Uint8Array = prev!;
    if (crop === null && prev) cur = prev;
    else if (!(frame.same && prev)) {
      cur = new Uint8Array(width * height);
      let last = -1,
        k = 0;
      const put = (p: number, v: number) => {
        v &= 0xffffff;
        if (v !== last) [last, k] = [v, index(rgbOf(v))];
        cur[p] = k;
      };
      if (crop) {
        if (prev) cur.set(prev);
        for (let y = crop.y0, q = 0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) put(y * width + x, crop.px[q++]);
      } else {
        const { data } = frame.load();
        const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
        for (let p = 0; p < cur.length; p++) put(p, px[p]);
      }
    }
    let rect = [0, 0, width - 1, height - 1];
    if (cur === prev) rect = [0, 0, -1, -1];
    else if (prev) {
      rect = [width, height, -1, -1];
      const wide = (width & 3) === 0;
      const a32 = wide ? new Uint32Array(cur.buffer) : cur,
        b32 = wide ? new Uint32Array(prev.buffer) : prev,
        row = wide ? width >> 2 : width;
      for (let y = crop?.y0 ?? 0; y <= (crop?.y1 ?? height - 1); y++) {
        let x = y * row;
        const end = x + row;
        while (x < end && a32[x] === b32[x]) x++;
        if (x === end) continue;
        const o = y * width;
        let x0 = 0,
          x1 = width - 1;
        while (cur[o + x0] === prev[o + x0]) x0++;
        while (cur[o + x1] === prev[o + x1]) x1--;
        if (x0 < rect[0]) rect[0] = x0;
        if (x1 > rect[2]) rect[2] = x1;
        if (y < rect[1]) rect[1] = y;
        rect[3] = y;
      }
    }
    // A 1 x 1 frame in the old color keeps the frame and its delay.
    if (rect[2] < 0) rect = [0, 0, 0, 0];
    bytes(0x21, 0xf9, 4, 1 << 2); // disposal method 1: the next frame draws over this frame
    word(frame.delay);
    bytes(0, 0, 0x2c);
    [rect[0], rect[1], rect[2] - rect[0] + 1, rect[3] - rect[1] + 1].forEach(word);
    byte(0);
    lzw(cur, width, rect, byte);
    prev = cur;
  }
  byte(0x3b);
  return buf.slice(0, len);
}
