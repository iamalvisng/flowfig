import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import fig from '/figures/checkout.ts';
window.warns = [];
console.warn = (m) => window.warns.push(String(m));
createRoot(document.getElementById('root')).render(createElement(Flow, { ...fig.props, check: true }));
`;

test('the player check warns of small text only when the text on screen is small', { skip: !browser.path }, async () => {
  await withReactPage(entry, async ({ ev, until, load }) => {
    const warns = async (width: number) => {
      await load(width);
      await until(`!!document.querySelector('[data-fig]')`, 'the figure renders');
      await new Promise((r) => setTimeout(r, 500));
      return (await ev('window.warns')) as string[];
    };

    assert.deepEqual(
      (await warns(390)).filter((w) => w.includes('small-text')),
      [],
      'the narrow rail draws 11 px text',
    );
    assert.match((await warns(600)).join(), /small-text/, 'the wide map scales its text below the minimum');
  });
});
