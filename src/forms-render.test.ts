import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import refund from '/figures/refund-process.ts';
import returns from '/figures/returns-process.ts';
import roadmap from '/figures/roadmap.ts';
const figs = { refund, returns, roadmap };
window.show = (fig) => createRoot(document.getElementById('root')).render(createElement(Flow, { ...figs[fig].props, check: true }));
`;

test(
  'the lanes and timeline forms draw boxes and select every step tab at a desktop and a phone box without a sideways page scroll',
  { skip: !browser.path },
  async () => {
    await withReactPage(entry, async ({ ev, until, load }) => {
      for (const fig of ['refund', 'returns', 'roadmap'])
        for (const width of [830, 390]) {
          await load(width);
          await until('!!window.show', 'the page loads');
          await ev(`show('${fig}')`);
          await until(`[...document.querySelectorAll('[data-fig]')].some((n) => n.getBoundingClientRect().width > 0)`, `${fig} has boxes`);
          const tabs = (await ev(`document.querySelectorAll('[role=tab]').length`)) as number;
          assert.ok(tabs > 0 || fig === 'roadmap', `${fig} has step tabs`);
          for (let i = 0; i < tabs; i++) {
            await ev(`document.querySelectorAll('[role=tab]')[${i}].click()`);
            await until(
              `document.querySelectorAll('[role=tab]')[${i}].getAttribute('aria-selected') === 'true'`,
              `${fig} tab ${i} is selected`,
            );
          }
          assert.equal(
            await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'),
            false,
            `${fig} at ${width} px scrolls the page sideways`,
          );
        }
    });
  },
);
