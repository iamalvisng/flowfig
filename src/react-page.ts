import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { findBrowser, launch } from './browser.ts';

export const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });

export type Page = {
  send: (method: string, params?: object) => Promise<any>;
  ev: (expression: string) => Promise<any>;
  until: (expression: string, what: string) => Promise<void>;
  load: (width: number) => Promise<void>;
};

export async function withReactPage(entry: string, run: (page: Page) => Promise<void>): Promise<void> {
  const out = (await build({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    plugins: [{ name: 'entry', resolveId: (id) => (id === 'entry' ? id : null), load: (id) => (id === 'entry' ? entry : null) }],
    build: { write: false, rollupOptions: { input: 'entry', output: { format: 'iife' } } },
  })) as Rolldown.RolldownOutput;
  const html = `<!doctype html><body style="margin:0"><div id="root"></div><script>${out.output[0].code}</script></body>`;
  const dir = mkdtempSync(join(tmpdir(), 'react-page-'));
  const { cdp, close } = await launch(browser.path!, join(dir, 'profile'), 120_000);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m: string, p?: object) => cdp.send(m, p, sessionId);
    const ev = async (e: string) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
    const until = async (e: string, what: string) => {
      for (let t = Date.now(); !(await ev(e)); await new Promise((r) => setTimeout(r, 50))) assert.ok(Date.now() - t < 4000, what);
    };
    const load = async (width: number) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      const { frameTree } = await send('Page.getFrameTree');
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    };
    await run({ send, ev, until, load });
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
}
