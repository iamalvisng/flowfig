import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { altText, type FlowProps } from './model.ts';
import { toSvg } from './svg.ts';
import { findBrowser, launch } from './browser.ts';

const { Flow } = await import(new URL('../dist/index.js', import.meta.url).href);

const fig: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Browser' },
      { id: 'b', label: 'Cache <hot> & "warm"' },
      { id: 'c', label: 'Database' },
    ],
  },
  edges: [
    { id: 'ab', from: 'a', to: 'b' },
    { id: 'bc', from: 'b', to: 'c' },
  ],
  steps: [
    {
      label: 'Miss & fill',
      flow: [{ edges: 'ab', say: 'The browser asks.' }, { edges: { edge: 'bc', back: true } }, { say: 'Pause.' }, {}],
    },
    { label: 'Hit', flow: ['ab'] },
  ],
};

const text = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

test('the transcript lists each say line in step order and names a silent hop by its box labels', () => {
  const { desc } = altText(fig);
  assert.deepEqual(desc.split('\n').slice(1), [
    'Miss & fill.',
    'The browser asks.',
    'Database to Cache <hot> & "warm"',
    'Pause.',
    'Hit.',
    'Browser to Cache <hot> & "warm"',
  ]);
});

test('the SVG escapes the title and transcript and stays valid XML text', () => {
  const svg = toSvg(fig);
  const title = /<title id="fig-title">([^<]*)<\/title>/.exec(svg)?.[1];
  const desc = /<desc id="fig-desc">([^<]*)<\/desc>/.exec(svg)?.[1];
  assert.ok(title && desc, 'title and desc hold no raw markup');
  assert.equal(text(title), 'Miss & fill, Hit');
  assert.match(desc, /Cache &lt;hot&gt; &amp; &quot;warm&quot;/);
  assert.match(svg, /^<svg [^>]*role="img" aria-labelledby="fig-title fig-desc"/);
});

test('the player and the SVG give the same title and transcript', () => {
  const html = renderToString(createElement(Flow, fig));
  const svg = toSvg(fig);
  const { title, desc } = altText(fig);
  assert.equal(text(/<title id="fig-title">([^<]*)/.exec(svg)![1]), title);
  assert.equal(text(/<desc id="fig-desc">([^<]*)/.exec(svg)![1]), desc);
  assert.equal(text(/role="figure" aria-label="([^"]*)"/.exec(html)![1]), title);
  assert.equal(text(/<div id="[^"]*" style="[^"]*">([^<]*)<\/div>/.exec(html)![1]), desc);
});

const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });

test('with reduced motion the SVG holds one frame at any time', { skip: !browser.path }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-'));
  const { cdp, close } = await launch(browser.path!, join(dir, 'profile'));
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m: string, p?: object) => cdp.send(m, p, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: toSvg(fig) });
    const shot = async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      return (await send('Page.captureScreenshot', { format: 'png' })).data as string;
    };
    const first = await shot(100);
    assert.equal(await shot(2500), first);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
