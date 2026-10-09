import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import checkout from '/figures/checkout.ts';
import lanes from '/figures/returns-process.ts';
window.warns = [];
console.warn = (m) => window.warns.push(String(m));
window.show = (fig) => createRoot(document.getElementById('root')).render(createElement(Flow, { ...(fig === 'lanes' ? lanes : checkout).props, check: true }));
`;

test('the player check warns of small text only when the text on screen is small', { skip: !browser.path }, async () => {
  await withReactPage(entry, async ({ ev, until, load }) => {
    const small = async (fig: string, width: number) => {
      await load(width);
      await until('!!window.show', 'the page loads');
      await ev(`show('${fig}')`);
      await until(`!!document.querySelector('[data-fig]')`, 'the figure renders');
      await new Promise((r) => setTimeout(r, 500));
      return ((await ev('window.warns')) as string[]).filter((w) => w.includes('small-text'));
    };

    for (const width of [390, 520, 600]) assert.deepEqual(await small('checkout', width), [], `the map folds to 11 px text at ${width} px`);
    assert.notDeepEqual(await small('lanes', 600), [], 'the lanes map does not fold and scales its text below the minimum');
  });
});
