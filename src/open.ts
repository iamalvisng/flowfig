// `flowfig open`: show a figure in the default browser. An .svg file often opens in an editor; an .html page opens in a browser.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pageHtml } from './page.ts';

const USAGE = 'usage: flowfig open <figure.svg> [--html <path>]';

export type Opener = { cmd: string; args: string[]; verbatim: boolean };

/** The command that opens a file in the default program of the system. Pure. */
export function openerFor(platform: NodeJS.Platform, file: string): Opener {
  if (platform === 'darwin') return { cmd: 'open', args: [file], verbatim: false };
  // `start` reads its first quoted argument as a window title, so an empty title goes first.
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`], verbatim: true };
  return { cmd: 'xdg-open', args: [file], verbatim: false };
}

/** The name of the temp page: the SVG base name, each character other than a letter, a digit, - or _ as -. */
export function pageName(svgPath: string): string {
  // The safe name also keeps cmd metacharacters such as & out of the Windows command line.
  return (
    basename(svgPath)
      .replace(/\.svg$/, '')
      .replace(/[^\w-]/g, '-') + '.html'
  );
}

/** The line that `open`, a render with `--open` and `draw --open` print. */
export const openedLine = (page: string) => `${page} — opened in the default browser`;

/** Write the page to a new temp folder (and to `html`, if given), then start the opener. Returns the written paths. */
export async function openSvg(svgPath: string, html?: string): Promise<string[]> {
  const page = pageHtml(readFileSync(svgPath, 'utf8'), basename(svgPath));
  // A fresh private folder (mode 0700): a fixed shared path lets another user plant a symlink there.
  const dir = mkdtempSync(join(tmpdir(), 'flowfig-open-'));
  // The page stays after the exit: the browser reads it after the CLI stops.
  const temp = join(dir, pageName(svgPath));
  writeFileSync(temp, page);
  if (html) writeFileSync(html, page);
  // FLOWFIG_OPENER replaces the system opener, so the tests start no browser.
  const o = process.env.FLOWFIG_OPENER
    ? { cmd: process.env.FLOWFIG_OPENER, args: [temp], verbatim: false }
    : openerFor(process.platform, temp);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(o.cmd, o.args, { detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: o.verbatim });
    child.once('spawn', () => (child.unref(), resolve()));
    child.once('error', (e) => reject(new Error(`${e.message}. Open ${temp} in a browser.`)));
  });
  return html ? [temp, html] : [temp];
}

/** `flowfig open`: parse argv, call openSvg, print. Returns the exit code. */
export async function runOpen(argv: string[]): Promise<number> {
  const fail = (message: string, code: number) => (console.error(message), code);
  const args = [...argv];
  let html: string | undefined;
  const at = args.indexOf('--html');
  if (at !== -1) {
    html = args.splice(at, 2)[1];
    if (!html || html.startsWith('-')) return fail('--html needs a path', 2);
  }
  const bad = args.find((a) => a.startsWith('-'));
  if (bad) return fail(`unknown flag ${bad}`, 2);
  const [path] = args;
  if (!path) return fail(USAGE, 2);
  if (!path.endsWith('.svg')) return fail(`${path}: expected a .svg path`, 2);
  try {
    readFileSync(path);
  } catch (e) {
    return fail(`${path}: ${(e as Error).message}`, 2);
  }
  try {
    const [page, copy] = await openSvg(path, html);
    console.log(openedLine(page));
    if (copy) console.log(copy);
    return 0;
  } catch (e) {
    return fail(`open: ${(e as Error).message}`, 1);
  }
}
