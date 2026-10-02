// The capture browser of `flowfig gif`: find it, start it in headless mode, and talk CDP to it over a pipe. Node only.
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import type { Readable, Writable } from 'node:stream';

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

export type Cdp = {
  send(method: string, params?: object, sessionId?: string, timeoutMs?: number): Promise<any>;
  once(event: string, sessionId?: string, timeoutMs?: number): Promise<any>;
};

type Waiter = { resolve: (v: any) => void; reject: (e: Error) => void };

/** Start the capture browser in headless mode with a CDP pipe. `close` stops it and never throws. */
export function launch(path: string, profile: string, timeoutMs = 30_000): Promise<{ cdp: Cdp; close: () => Promise<void> }> {
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    // The GPU raster gave a different pixel run to run on a rounded corner, and a bigger GIF.
    '--disable-gpu',
  ];
  // Chrome refuses to start as root without it, for example in a Docker container.
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const child = spawn(path, [...args, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    // Its own process group, so close can stop the helpers too. Not on Windows: there it opens a console window.
    detached: process.platform !== 'win32',
  });
  // The browser reads commands on fd 3 and writes replies on fd 4. A NUL byte ends each message.
  const out = child.stdio[3] as Writable,
    input = child.stdio[4] as Readable;
  out.on('error', () => {}); // a write after the exit fails; the exit handler below rejects the commands
  let tail = '',
    dead: Error | null = null,
    nextId = 1;
  child.stderr!.on('data', (d: Buffer) => (tail = (tail + d.toString()).slice(-2048)));
  const pending = new Map<number, Waiter & { method: string }>();
  const events: (Waiter & { event: string; sessionId?: string })[] = [];
  const stop = (e: Error) => {
    dead ??= e;
    for (const w of [...pending.values(), ...events.splice(0)]) w.reject(dead);
    pending.clear();
  };
  // The browser starts helper processes in its process group. A helper can outlive the browser and keep a pipe open.
  const killGroup = () => {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // the group is already gone
    }
  };
  const closed = new Promise<void>((done) => {
    const end = (e: Error) => (stop(e), done());
    const stopped = (code: number | null) => new Error(`the browser stopped (exit ${code}): ${tail.trim()}`);
    child.once('error', end);
    child.once('exit', (code) => {
      out.destroy(); // the write end of fd 3 does not close by itself, and 'close' waits for it
      killGroup();
      setTimeout(() => end(stopped(code)), 1000).unref(); // in case a pipe stays open after the group kill
    });
    child.once('close', (code) => end(stopped(code)));
  });

  let parts: Buffer[] = [];
  input.on('data', (chunk: Buffer) => {
    let start = 0;
    for (let end = chunk.indexOf(0); end !== -1; start = end + 1, end = chunk.indexOf(0, start)) {
      parts.push(chunk.subarray(start, end));
      const msg = JSON.parse(Buffer.concat(parts).toString('utf8'));
      parts = [];
      if (msg.id !== undefined) {
        const w = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) w?.reject(new Error(`${w.method}: ${msg.error.message}`));
        else w?.resolve(msg.result);
      } else {
        const i = events.findIndex((w) => w.event === msg.method && w.sessionId === msg.sessionId);
        if (i !== -1) events.splice(i, 1)[0].resolve(msg.params);
      }
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  });

  /** A promise that rejects after the timeout; `add` registers the waiter, `drop` removes it. */
  const timed = (label: string, add: (w: Waiter) => void, drop: () => void, ms = timeoutMs) =>
    new Promise<any>((resolve, reject) => {
      if (dead) return reject(dead);
      const timer = setTimeout(() => {
        drop();
        reject(new Error(`${label}: no reply in ${ms / 1000} s`));
      }, ms);
      add({ resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
    });
  const cdp: Cdp = {
    send: (method, params = {}, sessionId, ms) => {
      const id = nextId++;
      return timed(
        method,
        (w) => {
          pending.set(id, { ...w, method });
          out.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
        },
        () => pending.delete(id),
        ms,
      );
    },
    once: (event, sessionId, ms) => {
      let me: (typeof events)[number];
      return timed(
        event,
        (w) => events.push((me = { ...w, event, sessionId })),
        () => events.splice(events.indexOf(me), 1),
        ms,
      );
    },
  };
  // No Browser.close: the profile is a temp folder with nothing to keep, and Chrome takes about 10 s to exit after it.
  const close = async () => {
    killGroup();
    await closed;
  };
  return cdp.send('Browser.getVersion').then(
    () => ({ cdp, close }),
    async (e) => {
      await close();
      throw e;
    },
  );
}

export type Capture = { pngs: Buffer[]; width: number; height: number; loopMs: number };

/** Set the page, pause the animations and take one PNG per frame time. */
export async function captureFrames(
  cdp: Cdp,
  html: string,
  o: { width: number; height: number; scale: number; fps: number; dark: boolean },
): Promise<Capture> {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method: string, params?: object) => cdp.send(method, params, sessionId);
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Runtime.evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: o.scale, mobile: false });
  // The figure picks its theme with a media query, so the run sets the query and leaves the SVG as it is.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: o.dark ? 'dark' : 'light' }] });
  // The page goes in as content, not as a file: a snap browser has a private /tmp and cannot read the temp folder.
  const { frameTree } = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  // CSS animations are in getAnimations(). The packet moves with SMIL, which only the <svg> element controls.
  const info = await run(`(async () => {
    await document.fonts.ready;
    const svg = document.querySelector('svg');
    const css = document.getAnimations();
    for (const a of css) a.pause();
    svg.pauseAnimations();
    let loop = 0;
    for (const a of css) loop = Math.max(loop, Number(a.effect.getTiming().duration) || 0);
    for (const m of svg.querySelectorAll('animate, animateMotion, animateTransform, set'))
      try { loop = Math.max(loop, m.getSimpleDuration() * 1000); } catch {}
    const r = svg.getBoundingClientRect();
    return { loop, x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const n = Math.max(1, Math.round((info.loop * o.fps) / 1000));
  const clip = { x: info.x, y: info.y, width: info.width, height: info.height, scale: 1 };
  const pngs: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / o.fps;
    await run(`(() => {
      for (const a of document.getAnimations()) a.currentTime = ${t};
      document.querySelector('svg').setCurrentTime(${t / 1000});
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    pngs.push(Buffer.from(data, 'base64'));
  }
  return { pngs, width: Math.round(info.width * o.scale), height: Math.round(info.height * o.scale), loopMs: info.loop };
}
