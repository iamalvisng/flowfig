// Read the PNG screenshots of the capture browser. Only what Chrome writes: 8-bit RGB or RGBA, no interlace.
import { inflateSync } from 'node:zlib';

/** RGBA pixels, 4 bytes per pixel, rows top to bottom. */
export type Image = { width: number; height: number; data: Uint8Array };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(png: Uint8Array): Image {
  if (png.length < 8 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('not a PNG: bad signature');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0,
    height = 0,
    bpp = 0;
  const idat: Uint8Array[] = [];
  // The CRC of each chunk is not checked: the PNG comes from the browser over a local pipe.
  for (let at = 8; at + 8 <= png.length;) {
    const len = view.getUint32(at);
    const kind = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8) throw new Error(`unsupported PNG: bit depth ${body[8]}`);
      if (body[9] !== 2 && body[9] !== 6) throw new Error(`unsupported PNG: color type ${body[9]}`);
      if (body[12] !== 0) throw new Error(`unsupported PNG: interlace ${body[12]}`);
      bpp = body[9] === 6 ? 4 : 3;
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (!bpp) throw new Error('not a PNG: no IHDR chunk');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('not a PNG: the image data is too short');
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    // Undo the row filter in place. A Uint8Array write keeps the low 8 bits, as the PNG standard needs.
    if (filter === 1) for (let x = bpp; x < stride; x++) row[x] += row[x - bpp];
    else if (filter === 2) for (let x = 0; x < stride; x++) row[x] += prev[x];
    else if (filter === 3) for (let x = 0; x < stride; x++) row[x] += ((x >= bpp ? row[x - bpp] : 0) + prev[x]) >> 1;
    else if (filter === 4)
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0,
          b = prev[x],
          c = x >= bpp ? prev[x - bpp] : 0;
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        row[x] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
    else if (filter !== 0) throw new Error(`unsupported PNG: filter ${filter}`);
    for (let x = 0, o = y * width * 4; x < stride; x += bpp, o += 4) {
      data[o] = row[x];
      data[o + 1] = row[x + 1];
      data[o + 2] = row[x + 2];
      data[o + 3] = bpp === 4 ? row[x + 3] : 255;
    }
    prev = row;
  }
  return { width, height, data };
}
