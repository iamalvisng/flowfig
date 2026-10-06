import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pageHtml } from './page.ts';

const USAGE = 'usage: flowfig open <figure.svg> [--html <path>]';

export type Opener = { cmd: string; args: string[]; verbatim: boolean };

export function openerFor(platform: NodeJS.Platform, file: string): Opener {
  if (platform === 'darwin') return { cmd: 'open', args: [file], verbatim: false };
  // `start` reads its first quoted argument as a window title.
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', `"${file}"`], verbatim: true };
  return { cmd: 'xdg-open', args: [file], verbatim: false };
}

/** The temp page name: each character other than a letter, digit, - or _ becomes -. */
export function pageName(svgPath: string): string {
  // The safe name keeps cmd metacharacters such as & out of the command line.
  return (
    basename(svgPath)
      .replace(/\.svg$/, '')
      .replace(/[^\w-]/g, '-') + '.html'
  );
}

export const openedLine = (page: string) => `${page} — opened in the default browser`;

export async function openFile(path: string): Promise<void> {
  const o = process.env.FLOWFIG_OPENER
    ? { cmd: process.env.FLOWFIG_OPENER, args: [path], verbatim: false }
    : openerFor(process.platform, path);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(o.cmd, o.args, { detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: o.verbatim });
    child.once('spawn', () => (child.unref(), resolve()));
    child.once('error', (e) => reject(new Error(`${e.message}. Open ${path} in a browser.`)));
  });
}

/** Write the page to a new temp folder, then start the opener. Returns the written paths. */
export async function openSvg(svgPath: string, html?: string): Promise<string[]> {
  const page = pageHtml(readFileSync(svgPath, 'utf8'), basename(svgPath));
  // A fixed shared path lets another user plant a symlink.
  const dir = mkdtempSync(join(tmpdir(), 'flowfig-open-'));
  // The browser reads the page after the CLI stops, so keep it.
  const temp = join(dir, pageName(svgPath));
  writeFileSync(temp, page);
  if (html) writeFileSync(html, page);
  await openFile(temp);
  return html ? [temp, html] : [temp];
}

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
