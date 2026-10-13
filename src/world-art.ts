import type { FigLook } from './model.ts';

export type Pt = [number, number];
export type P3 = [number, number, number];
export const U = 40,
  C = U * Math.cos(Math.PI / 6),
  S = U / 2;
export const P = (x: number, y: number, z = 0): Pt => [(x - y) * C, (x + y) * S - z * U];
const f = (n: number) => Math.round(n * 10) / 10;
const pts = (a: Pt[]) => a.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
const poly = (a: Pt[], fill: string, ex = '') => `<polygon points="${pts(a)}" fill="${fill}" ${ex}/>`;
const FRONT = 4.6,
  WALK0 = 5.4,
  ROAD0 = 6.0,
  ROAD1 = 8.0,
  WALK1 = 8.6;
export const PITCH = 10.5,
  BY = 1.6;
type Mat = Record<string, string>;
type Building = { svg: string; ant: P3; own?: boolean; pts: P3[]; depot?: { x: number; y: number } };

const K = {
  ground: '#E8ECE3',
  lawn: '#DDE6D4',
  yard: '#D3DFC8',
  walk: '#F4F5F0',
  seam: '#E2E5DC',
  curb: '#C3C8CE',
  road: '#8A919B',
  dash: '#EEF0F2',
  glass: '#2a3446',
  glassR: '#222a39',
  light: '#f2b544',
  lightR: '#d99a2b',
  leaf: '#7DB27A',
  leafD: '#5E9660',
  trunk: '#6b5a49',
  ink: '#141A22',
  post: '#3b4252',
  ao: 'rgba(20,26,34,.11)',
};
const M: Record<string, Mat> = {
  brick: {
    l: '#c96a4b',
    r: '#a4513a',
    t: '#d6c0ab',
    e: '#6e3424',
    tex: '#b65d41',
    texR: '#934733',
    cap: '#f6ecdb',
    capR: '#dccdb4',
    fr: '#f3e8d6',
    frR: '#d9cbb3',
  },
  stone: {
    l: '#e9dcc0',
    r: '#cbbd9f',
    t: '#d9cfb8',
    e: '#8f8064',
    tex: '#d6c8a8',
    texR: '#b6a888',
    cap: '#fbf7ee',
    capR: '#ddd3bf',
    fr: '#7d7058',
    frR: '#6a5e48',
  },
  green: {
    l: '#86a581',
    r: '#678663',
    t: '#c3cac1',
    e: '#3c533d',
    tex: '#76946f',
    texR: '#587553',
    cap: '#eef0ea',
    capR: '#cdd3ca',
    fr: '#eef0ea',
    frR: '#cdd3ca',
  },
  slate: {
    l: '#434b5a',
    r: '#2e3440',
    t: '#5a6372',
    e: '#14181e',
    tex: '#515a6a',
    texR: '#3a414d',
    cap: '#717a8a',
    capR: '#5a6271',
    fr: '#6b7484',
    frR: '#555d6b',
  },
  pale: {
    l: '#e3e8ef',
    r: '#c3ccd8',
    t: '#d3dae4',
    e: '#5d6878',
    tex: '#d2d9e3',
    texR: '#b3bdcb',
    cap: '#f5f7fa',
    capR: '#dce2ea',
    fr: '#9aa5b5',
    frR: '#818c9c',
  },
  clay: {
    l: '#e7d3b4',
    r: '#c9b292',
    t: '#d9c8ad',
    e: '#7f6a4c',
    tex: '#dbc5a3',
    texR: '#b9a282',
    cap: '#f8f0e1',
    capR: '#ddd0b9',
    fr: '#f8f0e1',
    frR: '#ddd0b9',
    roof: '#7a4f3a',
    roofB: '#5f3c2c',
  },
  sand: {
    l: '#d8c49a',
    r: '#b9a57c',
    t: '#ccbf9f',
    e: '#6f6043',
    tex: '#cab68c',
    texR: '#a9966e',
    cap: '#f3ead6',
    capR: '#d6cbb2',
    fr: '#f3ead6',
    frR: '#d6cbb2',
  },
  marble: {
    l: '#ece8df',
    r: '#cfc9bc',
    t: '#dfdacf',
    e: '#7e776a',
    tex: '#e0dbd0',
    texR: '#bdb6a8',
    cap: '#faf8f3',
    capR: '#ddd8cc',
    fr: '#5e584d',
    frR: '#4e493f',
  },
  concrete: {
    l: '#cfd2cc',
    r: '#b0b4ad',
    t: '#c3c7c0',
    e: '#5b6058',
    tex: '#c2c6bf',
    texR: '#a2a69f',
    cap: '#eef0ec',
    capR: '#d1d4ce',
    fr: '#eef0ec',
    frR: '#d1d4ce',
  },
  plain: {
    l: '#dcd8cf',
    r: '#bfbab0',
    t: '#d0ccc3',
    e: '#716b60',
    tex: '#cfcbc1',
    texR: '#b0aba1',
    cap: '#f6f4ef',
    capR: '#d9d5cd',
    fr: '#f6f4ef',
    frR: '#d9d5cd',
  },
};

const quadT = (x0: number, x1: number, y0: number, y1: number, z: number, fill: string, ex = '') =>
  poly([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill, ex);
const quadL = (y: number, x0: number, x1: number, z0: number, z1: number, fill: string, ex = '') =>
  poly([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)], fill, ex);
const quadR = (x: number, y0: number, y1: number, z0: number, z1: number, fill: string, ex = '') =>
  poly([P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)], fill, ex);
const edge = (c: string) => `stroke="${c}" stroke-opacity=".55" stroke-width="1" stroke-linejoin="round"`;
const box = (x: number, y: number, z: number, w: number, d: number, h: number, t: string, l: string, r: string, e?: string) => {
  const ex = e ? edge(e) : '';
  return quadL(y + d, x, x + w, z, z + h, l, ex) + quadR(x + w, y, y + d, z, z + h, r, ex) + quadT(x, x + w, y, y + d, z + h, t, ex);
};
const mbox = (x: number, y: number, z: number, w: number, d: number, h: number, m: Mat) => box(x, y, z, w, d, h, m.t, m.l, m.r, m.e);
const line = (a: Pt, b: Pt, stroke: string, w = 1, ex = '') =>
  `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${stroke}" stroke-width="${w}" ${ex}/>`;
const ring = (fn: (t: number) => Pt, n = 28) => Array.from({ length: n }, (_, i) => fn((i / n) * Math.PI * 2));
const ellT = (cx: number, cy: number, z: number, r: number, fill: string, ex = '') =>
  poly(
    ring((t) => P(cx + r * Math.cos(t), cy + r * Math.sin(t), z)),
    fill,
    ex,
  );
const ao = (x: number, y: number, w: number, d: number) => quadT(x - 0.05, x + w + 0.45, y - 0.05, y + d + 0.22, 0, K.ao);
const coursesL = (Y: number, x0: number, x1: number, z0: number, z1: number, step: number, c: string) => {
  let o = '';
  for (let z = z0 + step; z < z1 - 0.02; z += step) o += line(P(x0, Y, z), P(x1, Y, z), c, 1);
  return o;
};
const coursesR = (X: number, y0: number, y1: number, z0: number, z1: number, step: number, c: string) => {
  let o = '';
  for (let z = z0 + step; z < z1 - 0.02; z += step) o += line(P(X, y0, z), P(X, y1, z), c, 1);
  return o;
};
const seamsL = (Y: number, x0: number, x1: number, z0: number, z1: number, step: number, c: string) => {
  let o = '';
  for (let x = x0 + step; x < x1 - 0.02; x += step) o += line(P(x, Y, z0), P(x, Y, z1), c, 1);
  return o;
};
const seamsR = (X: number, y0: number, y1: number, z0: number, z1: number, step: number, c: string) => {
  let o = '';
  for (let y = y0 + step; y < y1 - 0.02; y += step) o += line(P(X, y, z0), P(X, y, z1), c, 1);
  return o;
};
const cube = (x: number, y: number, z: number, w: number, d: number, h: number): P3[] =>
  [
    [x, y, z],
    [x + w, y, z],
    [x, y + d, z],
    [x + w, y + d, z],
  ].flatMap(([u, v]): P3[] => [
    [u, v, z],
    [u, v, z + h],
  ]);

function winL(m: Mat, Y: number, a: number, b: number, z0: number, z1: number, lit: boolean, cols = 2, transom = true) {
  const k = 0.05;
  let o = quadL(Y, a, b, z0, z1, m.fr) + quadL(Y, a + k, b - k, z0 + k, z1 - k, lit ? K.light : K.glass);
  for (let i = 1; i < cols; i++) {
    const x = a + ((b - a) * i) / cols;
    o += line(P(x, Y, z0 + k), P(x, Y, z1 - k), m.fr, 1.5);
  }
  if (transom) {
    const z = z0 + (z1 - z0) * 0.68;
    o += line(P(a + k, Y, z), P(b - k, Y, z), m.fr, 1.5);
  }
  return o + quadL(Y, a - 0.03, b + 0.03, z0 - 0.06, z0, m.cap);
}
function winR(m: Mat, X: number, a: number, b: number, z0: number, z1: number, lit: boolean, cols = 2, transom = true) {
  const k = 0.05;
  let o = quadR(X, a, b, z0, z1, m.frR) + quadR(X, a + k, b - k, z0 + k, z1 - k, lit ? K.lightR : K.glassR);
  for (let i = 1; i < cols; i++) {
    const y = a + ((b - a) * i) / cols;
    o += line(P(X, y, z0 + k), P(X, y, z1 - k), m.frR, 1.5);
  }
  if (transom) {
    const z = z0 + (z1 - z0) * 0.68;
    o += line(P(X, a + k, z), P(X, b - k, z), m.frR, 1.5);
  }
  return o + quadR(X, a - 0.03, b + 0.03, z0 - 0.06, z0, m.capR);
}
function roofWell(x: number, y: number, w: number, d: number, h: number, m: Mat, k = 0.12) {
  let o = quadT(x, x + w, y, y + d, h, m.cap, edge(m.e));
  o += quadT(x + k, x + w - k, y + k, y + d - k, h - 0.1, m.t);
  o += quadL(y + k, x + k, x + w - k, h - 0.1, h, m.tex) + quadR(x + k, y + k, y + d - k, h - 0.1, h, m.texR);
  o += quadT(x, x + w, y + d - k, y + d, h, m.cap) + quadT(x + w - k, x + w, y, y + d, h, m.cap);
  return o;
}
const hvac = (x: number, y: number, z: number, w = 0.8, d = 0.7, h = 0.35) =>
  box(x, y, z, w, d, h, '#e4e6e9', '#cfd3d8', '#aeb4bc', '#6b717a');
const door2 = (m: Mat, Y: number, a: number, b: number, h: number) =>
  quadL(Y, a, b, 0, h, m.fr) +
  quadL(Y, a + 0.06, b - 0.06, 0, h - 0.05, K.glass) +
  quadL(Y, (a + b) / 2 - 0.02, (a + b) / 2 + 0.02, 0, h - 0.05, m.fr);
const rollerL = (Y: number, a: number, b: number, h: number, frame: string, slat: string, slat2: string) => {
  let o = quadL(Y, a - 0.05, b + 0.05, 0, h + 0.05, frame) + quadL(Y, a, b, 0, h, slat);
  for (let z = 0.1; z < h - 0.05; z += 0.105) o += quadL(Y, a, b, z, z + 0.035, slat2);
  return o;
};
function house(x: number, y: number): Building {
  const m = M.clay,
    w = 3,
    d = 3,
    h = 1.15,
    rz = 0.95,
    o0 = 0.16,
    Y = y + d,
    X = x + w,
    ym = y + d / 2;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += coursesL(Y, x, X, 0, h, 0.13, m.tex) + coursesR(X, y, Y, 0, h, 0.13, m.texR);
  o += quadL(Y, x, X, 0, 0.1, m.texR) + quadR(X, y, Y, 0, 0.1, m.e, 'fill-opacity=".35"');
  o +=
    quadL(Y, x + 0.3, x + 0.9, 0, 0.92, '#5b3a2a') +
    quadL(Y, x + 0.36, x + 0.84, 0, 0.86, '#6f4733') +
    `<circle cx="${f(P(x + 0.76, Y, 0.45)[0])}" cy="${f(P(x + 0.76, Y, 0.45)[1])}" r="1.6" fill="${K.light}"/>`;
  o += quadL(Y, x + 0.22, x + 0.98, 0.92, 0.98, m.cap);
  o += winL(m, Y, x + 1.3, x + 2.0, 0.32, 0.86, true, 2, false) + winL(m, Y, x + 2.2, x + 2.8, 0.32, 0.86, false, 2, false);
  o += winR(m, X, y + 0.45, y + 1.15, 0.32, 0.86, true, 2, false) + winR(m, X, y + 1.85, y + 2.55, 0.32, 0.86, false, 2, false);
  o += poly([P(x - o0, y - o0, h), P(X + o0, y - o0, h), P(X + o0, ym, h + rz), P(x - o0, ym, h + rz)], m.roofB);
  o += poly([P(X, y, h), P(X, Y, h), P(X, ym, h + rz)], m.r, edge(m.e)) + coursesR(X, y + 0.5, Y - 0.5, h, h + rz * 0.5, 0.13, m.texR);
  o += winR(m, X, ym - 0.22, ym + 0.22, h + 0.18, h + 0.55, true, 1, false);
  o += poly([P(x - o0, Y + o0, h), P(X + o0, Y + o0, h), P(X + o0, ym, h + rz), P(x - o0, ym, h + rz)], m.roof, edge(m.e));
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    o += line(P(x - o0, Y + o0 - (Y + o0 - ym) * t, h + rz * t), P(X + o0, Y + o0 - (Y + o0 - ym) * t, h + rz * t), m.roofB, 1);
  }
  o += line(P(x - o0, ym, h + rz), P(X + o0, ym, h + rz), '#3e271c', 2);
  o +=
    box(x + 0.55, ym + 0.25, h + rz * 0.62, 0.36, 0.36, rz * 0.38 + 0.25, '#9c4f3a', '#8a4433', '#6f3628', '#4a241a') +
    box(x + 0.5, ym + 0.2, h + rz + 0.5, 0.46, 0.46, 0.08, '#b9b0a2', '#a39a8c', '#8a8274');
  return {
    svg: o,
    ant: [x + 2.5, ym, h + rz],
    pts: [
      ...cube(x - o0, y - o0, 0, w + 2 * o0, d + 2 * o0, h),
      [x - o0, ym, h + rz],
      [X + o0, ym, h + rz],
      [x + 0.5, ym + 0.2, h + rz + 0.6],
      [x + 0.96, ym + 0.66, h + rz + 0.6],
    ],
  };
}
function shop(x: number, y: number): Building {
  const m = M.brick,
    w = 3,
    d = 3,
    h = 1.5,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += coursesL(Y, x, X, 0, h, 0.12, m.tex) + coursesR(X, y, Y, 0, h, 0.12, m.texR);
  o += quadL(Y, x, X, 0, 0.12, m.r) + quadR(X, y, Y, 0, 0.12, m.e, 'fill-opacity=".5"');
  o +=
    quadL(Y, x + 1.05, x + 1.95, 0, 1.0, m.fr) +
    quadL(Y, x + 1.11, x + 1.89, 0, 0.94, K.glass) +
    quadL(Y, x + 1.49, x + 1.51, 0, 0.94, m.fr) +
    quadL(Y, x + 1.17, x + 1.83, 0.72, 0.88, K.light);
  o += winL(m, Y, x + 0.2, x + 0.85, 0.3, 0.95, true, 2, false) + winL(m, Y, x + 2.15, x + 2.8, 0.3, 0.95, true, 2, false);
  for (let i = 0; i < 7; i++) {
    const a = x + 0.12 + i * 0.395,
      b = a + 0.395;
    o += poly([P(a, Y, 1.14), P(b, Y, 1.14), P(b, Y + 0.38, 1.0), P(a, Y + 0.38, 1.0)], i % 2 ? '#9c4632' : '#f6ecdb', edge(m.e));
  }
  o += poly([P(x + 0.12, Y + 0.38, 1.0), P(x + 2.89, Y + 0.38, 1.0), P(x + 2.89, Y + 0.38, 0.94), P(x + 0.12, Y + 0.38, 0.94)], '#7c3626');
  o += winR(m, X, y + 0.4, y + 1.1, 0.45, 1.0, false) + winR(m, X, y + 1.5, y + 2.2, 0.45, 1.0, true);
  o += roofWell(x, y, w, d, h + 0.12, m);
  o += hvac(x + 0.4, y + 0.5, h + 0.02) + hvac(x + 1.95, y + 1.75, h + 0.02, 0.45, 0.45, 0.24);
  return { svg: o, ant: [x + 2.5, y + 0.7, h + 0.12], pts: cube(x, y, 0, w, d, h + 0.4) };
}
function office(x: number, y: number, floors: number): Building {
  const m = M.stone,
    w = 3,
    d = 3,
    h = 0.04 + 1.38 * floors,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += coursesL(Y, x, X, 0, h, 0.2, m.tex) + coursesR(X, y, Y, 0, h, 0.2, m.texR);
  for (let fl = 1; fl < floors; fl++)
    o += quadL(Y, x, X, fl * 1.38 - 0.04, fl * 1.38 + 0.06, m.cap) + quadR(X, y, Y, fl * 1.38 - 0.04, fl * 1.38 + 0.06, m.capR);
  o += quadL(Y, x, X, 0, 0.15, m.tex) + quadR(X, y, Y, 0, 0.15, m.texR);
  const lit = (k: number) => (k * 7) % 5 < 2;
  for (let fl = 0; fl < floors; fl++)
    for (let i = 0; i < 4; i++) {
      const z0 = 0.38 + fl * 1.38,
        z1 = z0 + 0.74,
        a = x + 0.22 + i * 0.68;
      if (!(fl === 0 && (i === 1 || i === 2))) o += winL(m, Y, a, a + 0.48, z0, z1, lit(fl * 4 + i), 2);
      const b = y + 0.22 + i * 0.68;
      o += winR(m, X, b, b + 0.48, z0, z1, lit(fl * 4 + i + 3), 2);
    }
  o +=
    quadL(Y, x + 1.0, x + 2.0, 0, 1.05, m.fr) + quadL(Y, x + 1.05, x + 1.95, 0, 1.0, K.glass) + quadL(Y, x + 1.48, x + 1.52, 0, 1.0, m.fr);
  o += quadL(Y, x + 1.1, x + 1.9, 0.75, 0.95, K.light);
  o += box(x + 0.85, Y, 1.08, 1.3, 0.45, 0.1, m.cap, m.cap, m.capR, m.e);
  o += roofWell(x, y, w, d, h + 0.12, m);
  o += hvac(x + 1.7, y + 0.4, h + 0.02, 0.9, 0.7, 0.45);
  for (let i = 0; i < 3; i++) o += quadL(y + 1.1, x + 1.8 + i * 0.25, x + 1.95 + i * 0.25, h + 0.12, h + 0.37, '#8b939f');
  o += box(x + 0.4, y + 1.6, h + 0.02, 0.5, 0.5, 0.3, m.cap, m.cap, m.capR, m.e);
  return { svg: o, ant: [x + 2.4, y + 2.3, h + 0.04], pts: cube(x, y, 0, w, d, h + 0.5) };
}
function depot(x: number, y: number): Building {
  const m = M.green,
    w = 3,
    d = 2,
    h = 1.4,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += seamsL(Y, x, X, 0, h, 0.12, m.tex) + seamsR(X, y, Y, 0, h, 0.12, m.texR);
  o += quadL(Y, x + 0.25, x + 1.85, 0, 1.08, m.fr) + quadL(Y, x + 0.3, x + 1.8, 0, 1.03, '#1d222b');
  o +=
    quadL(Y, x + 2.15, x + 2.6, 0, 0.88, m.fr) +
    quadL(Y, x + 2.2, x + 2.55, 0, 0.83, K.glass) +
    quadL(Y, x + 2.25, x + 2.5, 0.6, 0.78, K.light);
  o += winR(m, X, y + 0.35, y + 1.65, 0.55, 1.0, true, 3, false);
  o += quadT(x - 0.05, X + 0.05, y - 0.05, Y + 0.05, h, m.t, edge(m.e));
  for (let k = y + 0.1; k < Y; k += 0.16) o += line(P(x - 0.05, k, h), P(X + 0.05, k, h), '#a7b0a5', 1);
  o += quadL(Y + 0.05, x - 0.05, X + 0.05, h - 0.06, h, '#a7b0a5') + quadR(X + 0.05, y - 0.05, Y + 0.05, h - 0.06, h, '#8e978c');
  for (let i = 0; i < 3; i++) o += box(x + 0.4 + i * 0.85, y + 0.6, h, 0.5, 0.8, 0.14, '#e9eee8', '#dfe5dc', '#c3cbc0', m.e);
  return { svg: o, ant: [x + 2.6, y + 1.7, h], pts: cube(x, y, 0, w, d, h + 0.14), depot: { x, y: Y } };
}
function shed(x: number, y: number): Building {
  const m = M.sand,
    w = 3,
    d = 3,
    h = 1.35,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += seamsL(Y, x, X, 0, h, 0.15, m.tex) + seamsR(X, y, Y, 0, h, 0.15, m.texR);
  for (let i = 0; i < 3; i++) {
    const a = x + 0.2 + i * 0.95;
    o += box(a - 0.04, Y, 0, 0.75, 0.28, 0.32, '#8b8f96', '#9aa0a8', '#767b83', '#3b4252');
    o += rollerL(Y, a, a + 0.68, 0.86, m.fr, '#4f5866', '#6a7482');
    o += quadL(Y + 0.29, a + 0.02, a + 0.12, 0.12, 0.3, '#1d222b') + quadL(Y + 0.29, a + 0.56, a + 0.66, 0.12, 0.3, '#1d222b');
  }
  o += poly(
    [P(x - 0.05, Y, 1.12), P(X + 0.05, Y, 1.12), P(X + 0.05, Y + 0.3, 1.06), P(x - 0.05, Y + 0.3, 1.06)],
    '#aab3be',
    edge('#5b636f'),
  );
  o += quadL(Y + 0.3, x - 0.05, X + 0.05, 1.01, 1.06, '#7d8794');
  o += winR(m, X, y + 0.4, y + 2.6, 0.62, 1.05, true, 4, false);
  o += roofWell(x, y, w, d, h + 0.1, m);
  o += box(x + 0.35, y + 0.35, h + 0.02, 2.3, 0.5, 0.18, '#e9e4d6', '#d8d1bf', '#bdb5a2', m.e);
  o += box(x + 0.35, y + 1.25, h + 0.02, 2.3, 0.5, 0.18, '#e9e4d6', '#d8d1bf', '#bdb5a2', m.e);
  return { svg: o, ant: [x + 2.6, y + 2.4, h + 0.02], pts: cube(x, y, 0, w, d + 0.3, h + 0.3) };
}
function hall(x: number, y: number, m: Mat, led: string): Building {
  const w = 3,
    d = 3,
    h = 1.9,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += seamsL(Y, x, X, 0, h, 0.5, m.tex) + seamsR(X, y, Y, 0, h, 0.5, m.texR);
  o += coursesL(Y, x, X, 0, h, 0.63, m.tex) + coursesR(X, y, Y, 0, h, 0.63, m.texR);
  o +=
    quadL(Y, x + 1.15, x + 1.85, 0, 1.15, m.fr) +
    quadL(Y, x + 1.2, x + 1.8, 0, 1.1, '#1d222b') +
    quadL(Y, x + 1.49, x + 1.51, 0, 1.1, m.fr);
  o += quadL(Y, x + 1.92, x + 2.04, 0.5, 0.68, '#1d222b') + quadL(Y, x + 1.95, x + 2.01, 0.6, 0.65, K.light);
  for (let i = 0; i < 6; i++) {
    o += quadL(Y, x + 0.25, x + 0.95, 0.3 + i * 0.17, 0.37 + i * 0.17, m.e, 'fill-opacity=".7"');
    o += quadL(Y, x + 2.2, x + 2.8, 0.3 + i * 0.17, 0.37 + i * 0.17, m.e, 'fill-opacity=".7"');
  }
  for (let i = 0; i < 4; i++) {
    const b = y + 0.25 + i * 0.68;
    o += quadR(X, b, b + 0.42, 0.3, 1.5, m.frR) + quadR(X, b + 0.04, b + 0.38, 0.34, 1.46, '#1a1e26');
    for (let j = 0; j < 5; j++) o += quadR(X, b + 0.08, b + 0.14, 0.45 + j * 0.22, 0.5 + j * 0.22, j === 2 && i === 1 ? K.light : led);
  }
  o += roofWell(x, y, w, d, h + 0.12, m);
  o += box(x + 0.25, y + 0.3, h + 0.02, 0.25, 2.4, 0.08, m.cap, m.capR, m.texR);
  for (const [cx, cy] of [
    [x + 0.95, y + 0.55],
    [x + 0.95, y + 1.65],
  ]) {
    o += box(cx, cy, h + 0.02, 0.95, 0.9, 0.32, '#c9ced6', '#dfe3e9', '#a9b0bb', '#3d4659');
    const c = [cx + 0.475, cy + 0.45],
      zt = h + 0.35;
    o += ellT(c[0], c[1], zt, 0.33, '#2a3142') + ellT(c[0], c[1], zt + 0.01, 0.08, '#8b9099');
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3 + 0.4;
      o += line(P(c[0], c[1], zt + 0.01), P(c[0] + 0.3 * Math.cos(a), c[1] + 0.3 * Math.sin(a), zt + 0.01), '#8b9099', 1.5);
    }
  }
  return { svg: o, ant: [x + 2.5, y + 2.4, h + 0.04], pts: cube(x, y, 0, w, d, h + 0.4) };
}
function archive(x: number, y: number): Building {
  const m = M.marble,
    w = 3,
    d = 3,
    h = 1.55,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d + 0.5);
  o +=
    box(x - 0.1, y - 0.1, 0, w + 0.2, d + 0.6, 0.08, m.cap, m.tex, m.texR, m.e) +
    box(x - 0.05, y - 0.05, 0.08, w + 0.1, d + 0.35, 0.08, m.cap, m.tex, m.texR, m.e);
  o += mbox(x, y, 0.16, w, d, h - 0.16, m);
  o += coursesR(X, y, Y, 0.16, h, 0.24, m.texR);
  o +=
    quadL(Y, x + 1.15, x + 1.85, 0.16, 1.1, m.fr) +
    quadL(Y, x + 1.2, x + 1.8, 0.16, 1.05, '#3a352d') +
    quadL(Y, x + 1.49, x + 1.51, 0.16, 1.05, m.fr);
  for (const a of [x + 0.18, x + 0.68, x + 2.08, x + 2.58]) {
    o += quadL(Y + 0.25, a, a + 0.26, 0.16, h - 0.1, '#f7f4ee') + quadL(Y + 0.25, a + 0.18, a + 0.26, 0.16, h - 0.1, '#d8d2c5');
    o +=
      box(a - 0.03, Y + 0.12, 0.16, 0.32, 0.16, 0.06, m.cap, m.tex, m.texR) +
      box(a - 0.03, Y + 0.12, h - 0.14, 0.32, 0.16, 0.06, m.cap, m.tex, m.texR);
  }
  for (let i = 0; i < 4; i++) {
    const b = y + 0.35 + i * 0.62;
    o += quadR(X, b, b + 0.16, 0.45, 1.25, m.frR);
  }
  o += poly([P(x - 0.05, Y + 0.3, h), P(X + 0.05, Y + 0.3, h), P(X + 0.05, y, h), P(x - 0.05, y, h)], m.cap, edge(m.e));
  o += box(x - 0.05, y, h - 0.1, w + 0.1, d + 0.3, 0.12, m.cap, m.tex, m.texR, m.e);
  const pz = h + 0.02;
  o +=
    poly([P(x, Y + 0.3, pz), P(X, Y + 0.3, pz), P(x + w / 2, Y + 0.3, pz + 0.52)], m.l, edge(m.e)) +
    poly([P(x + 0.3, Y + 0.3, pz + 0.06), P(X - 0.3, Y + 0.3, pz + 0.06), P(x + w / 2, Y + 0.3, pz + 0.4)], m.tex);
  o += poly([P(X, Y + 0.3, pz), P(x + w / 2, Y + 0.3, pz + 0.52), P(x + w / 2, y + 0.2, pz + 0.52), P(X, y + 0.2, pz)], m.r, edge(m.e));
  o += quadT(x + 0.15, x + w / 2 - 0.1, y + 0.4, y + 1.2, pz, m.t);
  return {
    svg: o,
    ant: [x + 2.3, y + 0.7, h + 0.02],
    pts: [...cube(x - 0.1, y - 0.1, 0, w + 0.2, d + 0.6, h + 0.1), [x + w / 2, Y + 0.3, pz + 0.52], [x + w / 2, y + 0.2, pz + 0.52]],
  };
}
function works(x: number, y: number): Building {
  const m = M.concrete,
    w = 3,
    d = 3,
    h = 1.25,
    Y = y + d,
    X = x + w,
    tz = 0.55;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += seamsL(Y, x, X, 0, h, 0.5, m.tex) + seamsR(X, y, Y, 0, h, 0.5, m.texR);
  o += rollerL(Y, x + 0.3, x + 1.3, 0.95, m.fr, '#5a6b5f', '#71837a');
  o += winL(m, Y, x + 1.65, x + 2.75, 0.55, 0.98, true, 3, false) + winR(m, X, y + 0.3, y + 2.7, 0.55, 0.98, true, 4, false);
  const stack = (zTop: number) =>
    box(x + 2.35, y + 0.25, 0, 0.36, 0.36, zTop, '#a5503b', '#93463a', '#743628', '#4a241a') +
    box(x + 2.31, y + 0.21, zTop, 0.44, 0.44, 0.08, '#6b717a', '#5a6170', '#454b57');
  o += quadT(x, X, y, Y, h, m.t, edge(m.e));
  for (let k = 0; k < 3; k++) {
    const y0 = y + k,
      y1 = y0 + 1;
    o += poly([P(x, y0, h), P(X, y0, h), P(X, y1, h + tz), P(x, y1, h + tz)], '#8f97a1', edge('#3b4252'));
    o += quadL(y1, x, X, h, h + tz, '#2a3446') + seamsL(y1, x, X, h, h + tz, 0.3, '#5d6b80');
    o += poly([P(X, y0, h), P(X, y1, h), P(X, y1, h + tz)], m.r, edge(m.e));
    if (k === 0) o += stack(h + 1.75);
  }
  return {
    svg: o,
    ant: [x + 2.75, y + 2.95, h + tz],
    pts: [...cube(x, y, 0, w, d, h + tz), [x + 2.31, y + 0.21, h + 1.83], [x + 2.75, y + 0.65, h + 1.83]],
  };
}
function mast(x: number, y: number): Building {
  const m = M.concrete,
    Y = y + 3;
  let o = ao(x + 0.2, y + 1.3, 2.0, 1.7) + mbox(x + 0.2, y + 1.3, 0, 2.0, 1.7, 1.05, m);
  o +=
    quadL(Y, x + 0.9, x + 1.5, 0, 0.85, m.fr) +
    quadL(Y, x + 0.95, x + 1.45, 0, 0.8, '#5b636f') +
    quadL(Y, x + 0.4, x + 0.7, 0.5, 0.75, '#2e3440') +
    seamsL(Y, x + 0.4, x + 0.7, 0.5, 0.75, 0.06, '#5b636f');
  o += quadR(x + 2.2, y + 1.6, y + 2.6, 0.55, 0.8, '#2e3440') + seamsR(x + 2.2, y + 1.6, y + 2.6, 0.55, 0.8, 0.08, '#5b636f');
  o += roofWell(x + 0.2, y + 1.3, 2.0, 1.7, 1.12, m, 0.08);
  const b0 = [x + 1.6, y + 0.15] as const,
    s0 = 1.1,
    top = 4.6,
    s1 = 0.24,
    c0 = b0[0] + s0 / 2,
    c1 = b0[1] + s0 / 2;
  const leg = (sx: number, sy: number, z: number): P3 => {
    const s = s0 + (s1 - s0) * (z / top);
    return [c0 + (sx * s) / 2, c1 + (sy * s) / 2, z];
  };
  const st = '#4d5666',
    W = (p: P3) => P(...p);
  let mo = '';
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    mo += line(W(leg(sx, sy, 0)), W(leg(sx, sy, top)), st, 2.2);
  const zs = [0, 0.75, 1.5, 2.25, 3.0, 3.7, top];
  for (let i = 0; i < zs.length - 1; i++) {
    mo += line(W(leg(-1, 1, zs[i])), W(leg(1, 1, zs[i + 1])), st, 1.2) + line(W(leg(1, 1, zs[i])), W(leg(-1, 1, zs[i + 1])), st, 1.2);
    mo += line(W(leg(1, -1, zs[i])), W(leg(1, 1, zs[i + 1])), st, 1.2) + line(W(leg(1, 1, zs[i])), W(leg(1, -1, zs[i + 1])), st, 1.2);
    mo +=
      line(W(leg(-1, 1, zs[i + 1])), W(leg(1, 1, zs[i + 1])), st, 1.4) + line(W(leg(1, -1, zs[i + 1])), W(leg(1, 1, zs[i + 1])), st, 1.4);
  }
  for (const [dx, dy] of [
    [0, 0.17],
    [0.17, 0],
    [0.12, 0.12],
  ] as const)
    mo += box(c0 + dx - 0.05, c1 + dy - 0.05, 3.55, 0.1, 0.1, 0.65, '#eef0f2', '#dfe3e8', '#b9c0ca', '#5b636f');
  const dc = P(c0 + 0.15, c1 + 0.35, 2.7);
  mo += `<ellipse cx="${f(dc[0] + 3)}" cy="${f(dc[1])}" rx="7" ry="10" fill="#c9ced6" stroke="#5b636f" stroke-width="1"/><ellipse cx="${f(dc[0] + 4)}" cy="${f(dc[1])}" rx="2" ry="3" fill="#5b636f"/>`;
  const tp = W(leg(0, 0, top));
  mo += line(tp, [tp[0], tp[1] - 14], st, 1.6) + `<circle cx="${f(tp[0])}" cy="${f(tp[1] - 15)}" r="3" fill="#D63B2F"/>`;
  o = `<ellipse cx="${f(P(c0, c1)[0] + 6)}" cy="${f(P(c0, c1)[1] + 2)}" rx="34" ry="12" fill="${K.ao}"/>` + mo + o;
  return {
    svg: o,
    ant: [c0, c1, top + 0.45],
    own: true,
    pts: [...cube(x + 0.2, y + 1.3, 0, 2.0, 1.7, 1.12), leg(-1, -1, 0), leg(1, 1, 0), leg(1, -1, 0), [c0, c1, top + 0.45]],
  };
}
function plain(x: number, y: number): Building {
  const m = M.plain,
    w = 3,
    d = 3,
    h = 1.6,
    Y = y + d,
    X = x + w;
  let o = ao(x, y, w, d) + mbox(x, y, 0, w, d, h, m);
  o += coursesL(Y, x, X, 0, h, 0.4, m.tex) + coursesR(X, y, Y, 0, h, 0.4, m.texR);
  o += door2(m, Y, x + 1.15, x + 1.85, 0.95) + quadL(Y, x + 1.05, x + 1.95, 0.95, 1.02, '#9a9488');
  o += winL(m, Y, x + 0.3, x + 0.9, 0.35, 0.85, true, 2, false) + winL(m, Y, x + 2.1, x + 2.7, 0.35, 0.85, false, 2, false);
  o +=
    winL(m, Y, x + 0.3, x + 0.9, 1.05, 1.42, false, 2, false) +
    winL(m, Y, x + 1.2, x + 1.8, 1.05, 1.42, true, 2, false) +
    winL(m, Y, x + 2.1, x + 2.7, 1.05, 1.42, false, 2, false);
  for (let i = 0; i < 3; i++) {
    const b = y + 0.3 + i * 0.9;
    o += winR(m, X, b, b + 0.55, 0.35, 0.85, i === 1, 2, false) + winR(m, X, b, b + 0.55, 1.05, 1.42, i === 2, 2, false);
  }
  o += roofWell(x, y, w, d, h + 0.1, m);
  o += hvac(x + 1.6, y + 0.5, h + 0.02, 0.7, 0.6, 0.3);
  return { svg: o, ant: [x + 2.4, y + 2.3, h + 0.02], pts: cube(x, y, 0, w, d, h + 0.35) };
}
export const antenna = ([x, y, z]: P3) => {
  const b = P(x, y, z),
    t = P(x, y, z + 0.8),
    c = '#3b4252';
  let o = `<ellipse cx="${f(b[0])}" cy="${f(b[1])}" rx="4" ry="2" fill="${c}"/>` + line(b, t, c, 2);
  o += line(P(x - 0.16, y, z + 0.6), P(x + 0.16, y, z + 0.6), c, 1.6) + line(P(x, y - 0.16, z + 0.45), P(x, y + 0.16, z + 0.45), c, 1.6);
  return o + `<circle cx="${f(t[0])}" cy="${f(t[1])}" r="3.4" fill="#ffffff" stroke="#2456D6" stroke-width="2"/>`;
};
const BUILD: Record<FigLook, (x: number, y: number) => Building> = {
  person: house,
  phone: house,
  shop,
  desk: (x, y) => office(x, y, 2),
  team: (x, y) => office(x, y, 3),
  truck: depot,
  queue: shed,
  server: (x, y) => hall(x, y, M.slate, '#6f95e3'),
  cloud: (x, y) => hall(x, y, M.pale, '#3d7be0'),
  cabinet: archive,
  gear: works,
  tower: mast,
};

function tree(x: number, y: number, s = 1, kind = 0) {
  const [gx, gy] = P(x, y, 0);
  let o = `<ellipse cx="${f(gx + 6 * s)}" cy="${f(gy + 2)}" rx="${f(13 * s)}" ry="${f(6 * s)}" fill="${K.ao}"/>`;
  o += box(x - 0.06, y - 0.06, 0, 0.12, 0.12, 0.4 * s, K.trunk, K.trunk, '#574837');
  const [cx, cy] = P(x, y, 0.4 * s);
  if (kind === 0) {
    const r = 15 * s;
    o += `<circle cx="${f(cx)}" cy="${f(cy - r + 4)}" r="${f(r)}" fill="${K.leafD}"/>`;
    o += `<circle cx="${f(cx - r * 0.2)}" cy="${f(cy - r + 4 - r * 0.2)}" r="${f(r * 0.78)}" fill="${K.leaf}"/>`;
  } else {
    const h = 44 * s,
      w = 14 * s;
    o += poly(
      [
        [cx, cy - h],
        [cx + w, cy + 2],
        [cx, cy + 6 * s],
      ],
      K.leafD,
    );
    o += poly(
      [
        [cx, cy - h],
        [cx, cy + 6 * s],
        [cx - w, cy + 2],
      ],
      K.leaf,
    );
  }
  return o;
}
const shrub = (x: number, y: number, r: number) => {
  const [gx, gy] = P(x, y, 0),
    R = r * U;
  return `<ellipse cx="${f(gx + 3)}" cy="${f(gy + 1)}" rx="${f(R * 1.15)}" ry="${f(R * 0.5)}" fill="${K.ao}"/><circle cx="${f(gx)}" cy="${f(gy - R * 0.62)}" r="${f(R * 0.72)}" fill="${K.leafD}"/><circle cx="${f(gx - R * 0.16)}" cy="${f(gy - R * 0.74)}" r="${f(R * 0.52)}" fill="${K.leaf}"/>`;
};
function hull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [],
    up: Pt[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export type Lot = { x: number; hull: Pt[]; tag: Pt; door: number; depot: { x: number; y: number } | null; roof: Pt };

export function street(looks: (FigLook | undefined)[]): { svg: string; lots: Lot[] } {
  const n = looks.length,
    X0 = -40,
    X1 = (n - 1) * PITCH + 44;
  const xs = looks.map((_, i) => i * PITCH);
  let g = quadT(X0, X1, -40, FRONT - 0.15, 0, K.lawn) + quadT(X0, X1, WALK1, 60, 0, K.lawn);
  for (const x of xs)
    for (const [a, b, c, d] of [
      [-7.5, -2.5, 10.5, 15],
      [3, 8, 10.8, 14.6],
      [-6, -1.5, -6, 0.6],
    ])
      g += quadT(x + a, x + b, c, d, 0, K.yard);
  for (const x of xs) g += quadT(x - 0.3, x + 3.3, FRONT - 0.15, WALK0, 0, K.yard);
  const seamX = (x0: number, x1: number, y0: number, y1: number) => {
    let o = '';
    for (let x = Math.ceil(x0 * 2) / 2; x < x1; x += 0.5) o += line(P(x, y0), P(x, y1), K.seam, 1);
    return o;
  };
  g += quadT(X0, X1, WALK0, ROAD0, 0, K.walk) + seamX(X0, X1, WALK0, ROAD0);
  g += quadT(X0, X1, ROAD1, WALK1, 0, K.walk) + seamX(X0, X1, ROAD1, WALK1);
  g += quadT(X0, X1, ROAD0, ROAD1, 0, K.road);
  g += quadT(X0, X1, ROAD0, ROAD0 + 0.05, 0, K.curb) + quadT(X0, X1, ROAD1 - 0.05, ROAD1, 0, K.curb);
  for (let x = X0; x < X1; x += 1.2) g += quadT(x, x + 0.6, 7.18, 7.24, 0, K.dash);
  for (const x of xs) g += quadT(x + 1.05, x + 1.95, FRONT, WALK0, 0, K.walk) + seamX(x + 1.05, x + 1.95, FRONT, WALK0);

  const objs: [number, string][] = [],
    lots: Lot[] = [];
  looks.forEach((look, i) => {
    const x = xs[i],
      b = (look ? BUILD[look] : plain)(x, BY),
      tip: P3 = [b.ant[0], b.ant[1], b.ant[2] + (b.own ? 0 : 0.8)];
    if (!b.own) b.svg += antenna(b.ant);
    const hl = hull([...b.pts, tip].map((p) => P(...p))).map(([u, v]): Pt => [f(u), f(v)]);
    const top = hl.reduce((q, p) => (p[1] < q[1] ? p : q));
    const v = P(x, BY, 1.5);
    const [rx, ry] = P(...tip);
    lots.push({ x, hull: hl, tag: [f(v[0]), f(top[1])], door: x + 1.5, depot: b.depot ?? null, roof: [f(rx), f(ry)] });
    objs.push([x + 1.5 + BY + 1.5, `<g class="bld" id="b-${i}">${b.svg}</g>`]);
  });
  for (const x of xs) {
    for (const [dx, y, s, k] of [
      [-4.6, -1.6, 1, 0],
      [-2.6, 0.2, 0.9, 1],
      [4.4, -0.8, 0.85, 1],
      [7.4, -1.6, 1.0, 0],
      [-6.2, 12.4, 1.1, 0],
      [-4.4, 13.8, 0.9, 1],
      [4.6, 13.2, 1.0, 0],
      [6.6, 12.2, 0.9, 1],
    ])
      objs.push([x + dx + y, tree(x + dx, y, s, k)]);
    for (const [dx, r] of [
      [-4.2, 0.34],
      [-3.6, 0.28],
      [3.6, 0.3],
      [4.2, 0.36],
    ])
      objs.push([x + dx + 9.2, shrub(x + dx, 9.15, r)]);
  }
  const pads = xs
    .map((x, i) => `<g class="pad" id="pad-${i}">${quadT(x - 0.55, x + 3.55, BY - 0.55, BY + 3.5, 0, '#FBFAF3')}</g>`)
    .join('');
  return {
    svg:
      g +
      pads +
      objs
        .sort((p, q) => p[0] - q[0])
        .map((o) => o[1])
        .join(''),
    lots,
  };
}

export const LANE = 6.6,
  TD = 0.78,
  BAR_Y = 5.7,
  GZ = 0.8,
  GL = 1.2;
const BH = 0.46;

export const INK = { ink: '#141A22', data: '#2456D6', fail: '#B8322A', muted: '#646C79' };
const BARREL = { side: '#D9822B', shade: '#B4661D', top: '#EDAA5E', rim: '#6E3E10' };

const at = (p: Pt, inner: string, id = '') => `<g${id ? ` id="${id}"` : ''} transform="translate(${f(p[0])} ${f(p[1])})">${inner}</g>`;

function barrel() {
  const BR = 0.17,
    rx = BR * Math.SQRT2 * C,
    ry = BR * Math.SQRT2 * S,
    h = BH * U,
    k = 0.35,
    sk = Math.sqrt(1 - k * k);
  const T = BARREL;
  let o = `<path d="M${f(-rx)},${f(-h)} L${f(-rx)},0 A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)},0 L${f(rx)},${f(-h)} Z" fill="${T.side}"/>`;
  o += `<path d="M${f(k * rx)},${f(-h + ry * sk)} L${f(k * rx)},${f(ry * sk)} A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)},0 L${f(rx)},${f(-h)} A${f(rx)} ${f(ry)} 0 0 1 ${f(k * rx)},${f(-h + ry * sk)} Z" fill="${T.shade}"/>`;
  for (const q of [0.3, 0.68])
    o += `<path d="M${f(-rx)},${f(-h * q)} A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)},${f(-h * q)}" fill="none" stroke="${T.rim}" stroke-opacity=".7" stroke-width="1"/>`;
  o += `<path d="M${f(-rx)},${f(-h)} L${f(-rx)},0 A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)},0 L${f(rx)},${f(-h)}" fill="none" stroke="${T.rim}" stroke-opacity=".8" stroke-width="1"/>`;
  o += `<ellipse cx="0" cy="${f(-h)}" rx="${f(rx)}" ry="${f(ry)}" fill="${T.top}" stroke="${T.rim}" stroke-width="1"/>`;
  o += `<ellipse cx="0" cy="${f(-h)}" rx="${f(rx * 0.74)}" ry="${f(ry * 0.74)}" fill="none" stroke="${T.rim}" stroke-opacity=".55" stroke-width=".8"/>`;
  return o + `<ellipse cx="${f(rx * 0.38)}" cy="${f(-h - ry * 0.1)}" rx="1.6" ry="1" fill="${T.rim}"/>`;
}
function carton() {
  const w = 0.48,
    d = 0.48,
    h = 0.38,
    x = -w / 2,
    y = -d / 2;
  let o = box(x, y, 0, w, d, h, '#e3c48f', '#c99a5b', '#ad8046', '#6b4a22');
  o +=
    quadT(x + w / 2 - 0.035, x + w / 2 + 0.035, y, y + d, h, '#a07a45') +
    quadL(y + d, x + w / 2 - 0.035, x + w / 2 + 0.035, h - 0.12, h, '#a07a45');
  o += quadL(y + d, x + 0.06, x + 0.2, 0.08, 0.16, '#f4ecdc') + quadL(y + d, x + 0.06, x + 0.17, 0.2, 0.23, '#f4ecdc');
  return o;
}
function notes() {
  const w = 0.44,
    d = 0.28,
    h = 0.16,
    x = -w / 2,
    y = -d / 2;
  let o = box(x, y, 0, w, d, h, '#cfe3c9', '#7fb07a', '#5f9160', '#2f5a33');
  o += quadL(y + d, -0.04, 0.04, 0, h, '#f4f6fb') + quadT(-0.04, 0.04, y, y + d, h, '#f4f6fb');
  for (const k of [0.05, 0.1]) o += quadL(y + d, x + 0.02, x + w - 0.02, k, k + 0.012, '#5f9160');
  return o;
}
export const UNIT: Record<'box' | 'barrel' | 'notes', string> = { barrel: barrel(), box: carton(), notes: notes() };
export const FAIL_MARK = `<g class="failmark" display="none"><circle cx="0" cy="-30" r="8" fill="${INK.fail}" stroke="#fff" stroke-width="2"/><path d="M-3.2,-33.2 l6.4,6.4 M3.2,-33.2 l-6.4,6.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`;

export function truckArt(depot: { x: number; y: number }) {
  const ty = LANE - TD / 2,
    TY = ty + TD,
    bedL = 1.78,
    bedX = 0.68,
    m = M.green;
  const steel = ['#9aa2ae', '#7d8592', '#646c79', '#2a3142'];
  const rail = (x: number, y: number, w: number, d: number, z: number, h: number) =>
    box(x, y, z, w, d, h, steel[0], steel[1], steel[2], steel[3]);
  const wheelAt = (wx: number) =>
    poly(
      Array.from({ length: 20 }, (_, i): Pt => {
        const a = (i / 20) * Math.PI * 2;
        return P(wx + 0.17 * Math.cos(a), TY + 0.01, 0.2 + 0.17 * Math.sin(a));
      }),
      '#1b2130',
    ) +
    poly(
      Array.from({ length: 14 }, (_, i): Pt => {
        const a = (i / 14) * Math.PI * 2;
        return P(wx + 0.07 * Math.cos(a), TY + 0.02, 0.2 + 0.07 * Math.sin(a));
      }),
      '#8b9099',
    );
  let tBack = quadT(-0.05, 2.6, ty, TY + 0.25, 0, K.ao) + box(0, ty, 0.2, 2.5, TD, 0.16, '#3a4458', '#2a3142', '#222838', '#11151c');
  tBack +=
    box(0, ty, 0.36, 0.64, TD, 0.72, '#a9c2a4', m.l, m.r, m.e) +
    box(0.06, ty + 0.06, 1.08, 0.54, TD - 0.12, 0.05, '#c3d2bf', '#8fac8a', '#6f8c6b');
  tBack +=
    quadL(TY, 0.1, 0.52, 0.72, 0.98, K.glass) +
    quadR(0.64, ty + 0.08, TY - 0.08, 0.5, 0.98, '#587553') +
    quadL(TY, 0.08, 0.58, 0.42, 0.48, m.cap) +
    quadL(TY, 0.04, 0.14, 0.52, 0.6, K.light);
  tBack +=
    rail(bedX, ty, bedL, 0.05, 0.43, 0.36) +
    box(bedX, ty, 0.36, bedL, TD, 0.07, '#8b929d', '#6b7280', '#5a6170', '#2a3142') +
    rail(bedX, ty, 0.07, TD, 0.43, 0.5);
  const tailX = bedX + bedL - 0.05;
  let tFront = rail(bedX, TY - 0.05, bedL, 0.05, 0.43, 0.13) + rail(tailX, ty, 0.05, TD, 0.43, 0.2);
  tFront +=
    quadR(tailX + 0.05, ty + 0.05, ty + 0.15, 0.48, 0.56, INK.fail) + quadR(tailX + 0.05, TY - 0.15, TY - 0.05, 0.48, 0.56, INK.fail);
  tFront += [0.36, 1.64, 2.14].map(wheelAt).join('');
  const rBed = 0.04,
    rCab = 1.86;
  let rBack = quadT(-0.05, 2.6, ty, TY + 0.25, 0, K.ao) + box(0, ty, 0.2, 2.5, TD, 0.16, '#3a4458', '#2a3142', '#222838', '#11151c');
  rBack +=
    rail(rBed, ty, bedL, 0.05, 0.43, 0.36) +
    box(rBed, ty, 0.36, bedL, TD, 0.07, '#8b929d', '#6b7280', '#5a6170', '#2a3142') +
    rail(rBed, ty, 0.05, TD, 0.43, 0.2);
  let rFront = rail(rBed, TY - 0.05, bedL, 0.05, 0.43, 0.13) + rail(rBed + bedL - 0.07, ty, 0.07, TD, 0.43, 0.5);
  rFront +=
    box(rCab, ty, 0.36, 0.64, TD, 0.72, '#a9c2a4', m.l, m.r, m.e) +
    box(rCab + 0.04, ty + 0.06, 1.08, 0.54, TD - 0.12, 0.05, '#c3d2bf', '#8fac8a', '#6f8c6b');
  rFront +=
    quadR(rCab + 0.64, ty + 0.1, TY - 0.1, 0.72, 1.0, K.glassR) +
    quadL(TY, rCab + 0.12, rCab + 0.54, 0.72, 0.98, K.glass) +
    quadL(TY, rCab + 0.08, rCab + 0.58, 0.42, 0.48, m.cap) +
    quadL(TY, rCab + 0.5, rCab + 0.6, 0.52, 0.6, K.light);
  rFront += [0.36, 0.86, 2.14].map(wheelAt).join('');
  const slotsL = [0.27, 0.69, 1.11, 1.53].map((d) => bedX + d + 0.06),
    slotsR = [0.27, 0.69, 1.11, 1.53].map((d) => rBed + d - 0.04);
  const loadL = slotsL.map((x, i) => at(P(x, LANE, 0.43), '', 'tl' + i)).join(''),
    loadR = slotsR.map((x, i) => at(P(x, LANE, 0.43), '', 'tr' + i)).join('');
  const outDoor = hull(
    [depot.x + 0.2, depot.x + 1.9].flatMap((x) => [depot.y, depot.y + 6].flatMap((y) => [0, 2.5].map((z) => P(x, y, z)))),
  )
    .map((p) => p.map((v) => f(v)).join(','))
    .join(' ');
  let yTruck = quadT(-0.05, TD + 0.25, -0.05, 2.6, 0, K.ao) + box(0, 0, 0.2, TD, 2.5, 0.16, '#3a4458', '#2a3142', '#222838', '#11151c');
  yTruck += rail(0, 0.04, 0.05, 1.78, 0.43, 0.36) + box(0, 0.04, 0.36, TD, 1.78, 0.07, '#8b929d', '#6b7280', '#5a6170', '#2a3142');
  yTruck += rail(0, 0.04, TD, 0.05, 0.43, 0.2) + rail(TD - 0.05, 0.04, 0.05, 1.78, 0.43, 0.13) + rail(0, 1.75, TD, 0.07, 0.43, 0.5);
  yTruck +=
    box(0, 1.86, 0.36, TD, 0.64, 0.72, '#a9c2a4', m.l, m.r, m.e) +
    box(0.06, 1.92, 1.08, TD - 0.12, 0.52, 0.05, '#c3d2bf', '#8fac8a', '#6f8c6b');
  yTruck +=
    quadL(2.5, 0.1, TD - 0.1, 0.72, 1.0, K.glass) +
    quadR(TD, 1.95, 2.4, 0.72, 0.98, K.glassR) +
    quadL(2.5, 0.08, TD - 0.08, 0.42, 0.48, m.cap);
  yTruck += quadL(2.5, 0.05, 0.16, 0.52, 0.6, K.light) + quadL(2.5, TD - 0.16, TD - 0.05, 0.52, 0.6, K.light);
  yTruck += [0.36, 0.86, 2.14]
    .map(
      (wy) =>
        poly(
          Array.from({ length: 20 }, (_, i): Pt => {
            const a = (i / 20) * Math.PI * 2;
            return P(TD + 0.01, wy + 0.17 * Math.cos(a), 0.2 + 0.17 * Math.sin(a));
          }),
          '#1b2130',
        ) +
        poly(
          Array.from({ length: 14 }, (_, i): Pt => {
            const a = (i / 14) * Math.PI * 2;
            return P(TD + 0.02, wy + 0.07 * Math.cos(a), 0.2 + 0.07 * Math.sin(a));
          }),
          '#8b9099',
        ),
    )
    .join('');
  return {
    door: `<g id="depotDoor">${quadL(depot.y + 0.002, depot.x + 0.3, depot.x + 1.8, 0, 1.03, '#1d222b')}<g id="doorPanel"></g></g>`,
    yard: `<clipPath id="outDoor"><polygon points="${outDoor}"/></clipPath><g clip-path="url(#outDoor)"><g id="truckY">${yTruck}</g></g>`,
    road: `<g id="truck" display="none"><g>${tBack}</g><g>${loadL}</g><g>${tFront}</g></g><g id="truckR" display="none"><g>${rBack}</g><g>${loadR}</g><g>${rFront}</g></g>`,
    slots: { L: slotsL, R: slotsR },
  };
}

const screens = `<g class="scr" data-s="idle"><path d="M-6,-5 h12 M-6,0 h9 M-6,5 h7" stroke="${INK.ink}" stroke-opacity=".4" stroke-width="1.6" stroke-linecap="round"/></g>
<g class="scr" data-s="in" display="none"><rect x="-7" y="-9" width="14" height="9" rx="2" fill="${INK.data}"/><path d="M-6,4 h12 M-6,8 h8" stroke="${INK.ink}" stroke-opacity=".4" stroke-width="1.6" stroke-linecap="round"/></g>`;
function phone(w: number, h: number) {
  let o = `<rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" rx="${f(w * 0.2)}" fill="${INK.ink}"/>`;
  o += `<rect x="${f(-w / 2 + w * 0.09)}" y="${f(-h + h * 0.12)}" width="${f(w * 0.82)}" height="${f(h * 0.76)}" rx="${f(w * 0.08)}" fill="#F4F5F0"/>`;
  o += `<rect x="${f(-w * 0.12)}" y="${f(-h + h * 0.045)}" width="${f(w * 0.24)}" height="${f(h * 0.03)}" rx="1" fill="#3b4252"/>`;
  return `${o}<g transform="translate(0 ${f(-h / 2)})">${screens}</g>`;
}
export const PHONE = { svg: phone(26, 46), w: 26, h: 46 };

export type Gate = { px: number; ex: number; y: number; z: number; L: number };
export function gateArt(g: Gate) {
  const post = (x: number, h: number) => box(x - 0.09, g.y - 0.09, 0, 0.18, 0.18, h, '#5a6372', '#434b5a', '#2e3440', '#14181e');
  const b = P(g.px, g.y);
  return `<ellipse cx="${f(b[0] + 4)}" cy="${f(b[1] + 1)}" rx="12" ry="5" fill="${K.ao}"/>
  ${post(g.ex, GZ - 0.1)}${box(g.ex - 0.13, g.y - 0.13, GZ - 0.1, 0.26, 0.26, 0.05, '#2e3440', '#2e3440', '#1d222b')}
  ${post(g.px, GZ + 0.12)}${box(g.px - 0.32, g.y - 0.11, GZ - 0.14, 0.24, 0.22, 0.22, '#5a6372', '#434b5a', '#2e3440', '#14181e')}
  <line class="arm" stroke-width="5" stroke-linecap="round"/><line class="armW" stroke="#ffffff" stroke-width="5" stroke-dasharray="6 6"/><circle class="hub" r="3.5" fill="#2e3440"/>`;
}
