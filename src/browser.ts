// The capture browser of `flowfig gif`: find it, start it in headless mode, and talk CDP to it over a pipe. Node only.
import { win32 } from 'node:path';

export type Found = { path: string | null; checked: string[] };

const MAC = ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/usr/bin/brave-browser',
  '/opt/google/chrome/chrome',
];
const WINDOWS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
  'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'Chromium\\Application\\chrome.exe',
];

/** The first capture browser that exists. `CHROME_PATH` wins. Pure apart from `exists`. */
export function findBrowser(o: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
}): Found {
  const { env } = o;
  const paths = env.CHROME_PATH
    ? [env.CHROME_PATH]
    : o.platform === 'darwin'
      ? MAC
      : o.platform === 'win32'
        ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].flatMap((dir) =>
            dir ? WINDOWS.map((p) => win32.join(dir, p)) : [],
          )
        : LINUX;
  const checked: string[] = [];
  for (const p of paths) {
    checked.push(p);
    if (o.exists(p)) return { path: p, checked };
  }
  return { path: null, checked };
}
