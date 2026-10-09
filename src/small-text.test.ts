import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { findBrowser, launch } from './browser.ts';

const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import fig from '/figures/checkout.ts';
window.warns = [];
console.warn = (m) => window.warns.push(String(m));
createRoot(document.getElementById('root')).render(createElement(Flow, { ...fig.props, check: true }));
`;

async function page(): Promise<string> {
  const out = (await build({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    plugins: [{ name: 'entry', resolveId: (id) => (id === 'entry' ? id : null), load: (id) => (id === 'entry' ? entry : null) }],
    build: { write: false, rollupOptions: { input: 'entry', output: { format: 'iife' } } },
  })) as Rolldown.RolldownOutput;
  return `<!doctype html><body style="margin:0"><div id="root"></div><script>${out.output[0].code}</script></body>`;
}

test('the player check warns of small text only when the text on screen is small', { skip: !browser.path }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'small-text-'));
  const { cdp, close } = await launch(browser.path!, join(dir, 'profile'), 120_000);
  try {
    const html = await page();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m: string, p?: object) => cdp.send(m, p, sessionId);
    const ev = async (e: string) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
    const warns = async (width: number) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      const { frameTree } = await send('Page.getFrameTree');
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
      for (let t = Date.now(); !(await ev(`!!document.querySelector('[data-fig]')`)); await new Promise((r) => setTimeout(r, 50)))
        assert.ok(Date.now() - t < 4000, 'the figure renders');
      await new Promise((r) => setTimeout(r, 500));
      return (await ev('window.warns')) as string[];
    };

    assert.deepEqual(
      (await warns(390)).filter((w) => w.includes('small-text')),
      [],
      'the narrow rail draws 11 px text',
    );
    assert.match((await warns(600)).join(), /small-text/, 'the wide map scales its text below the minimum');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
