import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import checkout from '/figures/checkout.ts';
import lanes from '/figures/returns-process.ts';
import status from '/figures/order-status.ts';
const figs = { checkout, lanes, status };
window.warns = [];
console.warn = (m) => window.warns.push(String(m));
window.show = (fig) => createRoot(document.getElementById('root')).render(createElement(Flow, { ...figs[fig].props, check: true }));
`;

test(
  'the player keeps reader text at 11 px under a 600 px box and 9 px from 600 px, and warns only below that',
  { skip: !browser.path },
  async () => {
    await withReactPage(entry, async ({ ev, until, load }) => {
      const show = async (fig: string, width: number) => {
        await load(width);
        await until('!!window.show', 'the page loads');
        await ev(`show('${fig}')`);
        await until(`!!document.querySelector('[data-fig]')`, 'the figure renders');
        await new Promise((r) => setTimeout(r, 500));
        return {
          small: ((await ev('window.warns')) as string[]).filter((w) => w.includes('small-text')),
          scale: (await ev(
            `(() => { const m = document.querySelector('[role=tabpanel]').firstElementChild; return m.getBoundingClientRect().width / m.offsetWidth; })()`,
          )) as number,
          paneScrolls: (await ev(
            `(() => { const p = document.querySelector('[role=tabpanel]'); return getComputedStyle(p).overflowX === 'auto' && p.scrollWidth > p.clientWidth; })()`,
          )) as boolean,
          pageScrolls: (await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth')) as boolean,
        };
      };

      for (const width of [320, 390, 520, 600])
        assert.deepEqual((await show('checkout', width)).small, [], `the map folds to 11 px text at ${width} px`);
      assert.ok((await show('checkout', 680)).scale > 0.99, 'a desktop map with 8 px text folds');
      assert.ok((await show('status', 680)).scale < 0.99, 'a desktop map with 10 px text stays a scaled row');
      assert.deepEqual((await show('checkout', 830)).small, [], 'a desktop row with 10 px text gives no warning');
      const lanes = await show('lanes', 680);
      assert.ok(lanes.scale >= 9 / 11 - 0.001, 'the lanes map scales its text to 9 px at most');
      assert.deepEqual(lanes.small, []);
      assert.ok(lanes.paneScrolls, 'the lanes map pane scrolls sideways');
      assert.ok(!lanes.pageScrolls, 'the page does not scroll sideways');
    });
  },
);
