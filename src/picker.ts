// The arrow-key picker for `flowfig init`. The screen and the keys are pure, so the tests need no TTY.
import { emitKeypressEvents } from 'node:readline';

export type PickRow = { id: string; name: string; detected: boolean; files: string[] };
export type PickState = { rows: PickRow[]; sel: Set<string>; mcp: boolean; cursor: number };
export type Key = { name?: string; ctrl?: boolean; sequence?: string };
export type Screen = { color: boolean; width: number };
export type Picked = { ids: Set<string>; mcp: boolean };

const GLYPH: Record<string, string[]> = {
  F: ['█████', '█    ', '████ ', '█    ', '█    '],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  W: ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  G: [' ████', '█    ', '█  ██', '█   █', ' ███ '],
};
const BANNER = [0, 1, 2, 3, 4].map((r) => [...'FLOWFIG'].map((c) => GLYPH[c][r]).join(' '));
const BANNER_WIDTH = BANNER[0].length;
const HELP = '↑↓ move · space toggle · a all · enter confirm · esc cancel';

const ansi = (on: boolean, code: string, text: string) => (on ? `\x1b[${code}m${text}\x1b[0m` : text);
/** Row `i` of `n`: the blue gradient from #4da3ff to #0074d9. */
const blue = (i: number, n: number) => {
  const mix = (a: number, b: number) => Math.round(a + ((b - a) * i) / (n - 1));
  return `38;2;${mix(0x4d, 0x00)};${mix(0xa3, 0x74)};${mix(0xff, 0xd9)}`;
};

/** The banner lines. A terminal narrower than the banner gets the plain word. */
export function banner({ color, width }: Screen): string[] {
  if (width < BANNER_WIDTH) return [ansi(color, '1;38;2;77;163;255', 'flowfig')];
  return BANNER.map((l, i) => ansi(color, blue(i, BANNER.length), l));
}

/** Cut the pieces `[text, colour code]` to `width` visible characters, then colour them. */
function fit(pieces: [string, string][], width: number, color: boolean): string {
  let room = width;
  let out = '';
  for (const [text, code] of pieces) {
    const cut = text.length > room ? `${text.slice(0, Math.max(room - 1, 0))}…` : text;
    out += code ? ansi(color, code, cut) : cut;
    room -= cut.length;
    if (room <= 0) break;
  }
  return out;
}

/** The picker screen, one string per line. */
export function screen(s: PickState, o: Screen): string[] {
  const w = Math.max(o.width - 1, 1); // the last column stays free, so no row wraps
  const pad = Math.max(...s.rows.map((r) => r.name.length), 10);
  const mark = (i: number) => (i === s.cursor ? '›' : ' ');
  const rows = s.rows.map((r, i) =>
    fit(
      [
        [`${mark(i)} [${s.sel.has(r.id) ? 'x' : ' '}] `, ''],
        [r.name.padEnd(pad), ''],
        ...(r.detected ? [] : ([[' (not detected)', '90']] as [string, string][])),
        [`  ${r.files.join(', ')}`, '36'],
      ],
      w,
      o.color,
    ),
  );
  const mcp = fit(
    [
      [`${mark(s.rows.length)} [${s.mcp ? 'x' : ' '}] `, ''],
      ['MCP server'.padEnd(pad), ''],
      ['  register flowfig in the MCP file of each agent', '36'],
    ],
    w,
    o.color,
  );
  return [
    ...banner(o),
    '',
    fit([['Pick the coding agents that should draw diagrams in this repo.', '']], w, o.color),
    '',
    ...rows,
    ansi(o.color, '90', '─'.repeat(Math.min(w, 40))),
    mcp,
    '',
    fit([[HELP, '90']], w, o.color),
  ];
}

/** One key press. Returns the next state, or `confirm` or `cancel`. */
export function keyStep(s: PickState, k: Key): PickState | 'confirm' | 'cancel' {
  const last = s.rows.length; // the MCP row
  const n = last + 1;
  if (k.name === 'escape' || k.name === 'q' || (k.ctrl && k.name === 'c')) return 'cancel';
  if (k.name === 'return') return 'confirm';
  if (k.name === 'up' || k.name === 'k') return { ...s, cursor: (s.cursor + n - 1) % n };
  if (k.name === 'down' || k.name === 'j') return { ...s, cursor: (s.cursor + 1) % n };
  if (k.name === 'space') {
    if (s.cursor === last) return { ...s, mcp: !s.mcp };
    const id = s.rows[s.cursor].id;
    const sel = new Set(s.sel);
    sel.has(id) ? sel.delete(id) : sel.add(id);
    return { ...s, sel };
  }
  if (k.name === 'a') return { ...s, sel: s.sel.size === last ? new Set() : new Set(s.rows.map((r) => r.id)) };
  return s;
}

/** Run the picker on the terminal. Returns `undefined` on cancel, or `'fallback'` if the terminal has no raw mode. */
export function runPicker(rows: PickRow[], start: Set<string>, mcp: boolean): Promise<Picked | undefined | 'fallback'> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return Promise.resolve('fallback');
  try {
    stdin.setRawMode(true);
  } catch {
    return Promise.resolve('fallback');
  }
  const color = process.env.NO_COLOR === undefined;
  let state: PickState = { rows, sel: start, mcp, cursor: 0 };
  let drawn = 0;
  const draw = () => {
    const lines = screen(state, { color, width: stdout.columns || 80 });
    stdout.write(`${drawn ? `\x1b[${drawn}A\r\x1b[J` : ''}${lines.join('\n')}\n`);
    drawn = lines.length;
  };
  return new Promise((resolve, reject) => {
    const end = (r?: Picked) => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(`\x1b[${drawn}A\r\x1b[J\x1b[?25h`);
      resolve(r);
    };
    const onKey = (_: string, key: Key = {}) => {
      try {
        const next = keyStep(state, key);
        if (next === 'cancel') return end();
        if (next === 'confirm') return end({ ids: state.sel, mcp: state.mcp });
        state = next;
        draw();
      } catch (e) {
        stdin.off('keypress', onKey);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\x1b[?25h');
        reject(e);
      }
    };
    emitKeypressEvents(stdin);
    stdin.on('keypress', onKey);
    stdin.resume();
    stdout.write('\x1b[?25l');
    draw();
  });
}
