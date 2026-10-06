import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atlasFiles } from './atlas.ts';
import { findBrowser, launch } from './browser.ts';
import { svgWithSpec } from './load.ts';
import type { FlowProps } from './model.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');

const fig = (id: string, label: string, detail: string): FlowProps => ({
  layout: {
    children: [
      { id, label, detail },
      { id: 'other', label: 'Other' },
    ],
  },
  edges: [{ from: id, to: 'other' }],
});

const write = (dir: string, label: string) => {
  mkdirSync(join(dir, 'docs/flows'), { recursive: true });
  writeFileSync(join(dir, 'docs/system.svg'), svgWithSpec(fig('orders', label, 'docs/flows/orders.svg')));
  writeFileSync(join(dir, 'docs/flows/orders.svg'), svgWithSpec(fig('up', 'Whole system', 'docs/system.svg')));
};

const withAtlas = async (run: (dir: string, out: string) => Promise<void> | void) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
  try {
    write(dir, 'Order service');
    const out = join(dir, 'site');
    spawnSync(process.execPath, [cli, 'atlas', '--root', dir, '--out', out]);
    await run(dir, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('linked figures point at each other by relative links, and the page links back to the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
  try {
    write(dir, 'Order <svc>');
    const site = atlasFiles({ root: dir });
    const down = site.get('docs/system.html')!;
    assert.match(down, /<a href="flows\/orders\.html" tabindex="-1">/);
    assert.match(down, /<li>Order &lt;svc&gt;: <a href="flows\/orders\.html">docs\/flows\/orders\.svg<\/a><\/li>/);
    assert.match(down, /<a href="\.\.\/index\.html">All figures<\/a>/);
    assert.match(site.get('docs/flows/orders.html')!, /<a href="\.\.\/system\.html">docs\/system\.svg<\/a>/);
    assert.match(site.get('index.html')!, /<a href="docs\/flows\/orders\.html">/);
    assert.match(down, /<title>[^<]*<\/title>[\s\S]*<desc[^>]*>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atlas exits 1 when no figure matches and 2 for an unknown flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
  try {
    const run = (...a: string[]) => spawnSync(process.execPath, [cli, 'atlas', '--root', dir, '--out', join(dir, 'o'), ...a]).status;
    assert.equal(run(), 1);
    assert.equal(run('--nope'), 2);
    assert.equal(existsSync(join(dir, 'o')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });

test('the Details list opens the target by keyboard, and a click on the box opens it', { skip: !browser.path }, async () => {
  await withAtlas(async (dir, out) => {
    const { cdp, close } = await launch(browser.path!, join(dir, 'profile'));
    try {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (m: string, p?: object) => cdp.send(m, p, sessionId);
      const ev = async (e: string) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
      const open = async () => {
        await send('Page.enable');
        const loaded = cdp.once('Page.loadEventFired', sessionId);
        await send('Page.navigate', { url: pathToFileURL(join(out, 'docs/system.html')).href });
        await loaded;
      };
      const target = pathToFileURL(join(out, 'docs/flows/orders.html')).href;
      await open();
      let focused = false;
      for (let i = 0; i < 6 && !focused; i++) {
        for (const type of ['keyDown', 'keyUp'])
          await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        focused = await ev('document.activeElement.getAttribute("href") === "flows/orders.html"');
      }
      assert.ok(focused, 'Tab reaches the Details link');
      for (const type of ['keyDown', 'keyUp'])
        await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(await ev('location.href'), target);
      await open();
      const [x, y] = await ev(
        '(() => { const r = document.querySelector("svg a[href]").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()',
      );
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(await ev('location.href'), target);
    } finally {
      await close();
    }
  });
});
