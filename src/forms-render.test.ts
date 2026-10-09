import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';
import { check } from './svg.ts';
import type { FlowProps } from './model.ts';

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

const busy: FlowProps = {
  layout: {
    auto: true,
    children: [
      { id: 'v', label: 'Visitor' },
      { id: 'm', label: 'Admin' },
      { id: 'f', label: 'Form' },
      { id: 'c', label: 'Valid?', shape: 'decision' },
      { id: 'x', label: 'Show error' },
      { id: 'k', label: 'Save' },
      { id: 'l', label: 'Log' },
    ],
  },
  edges: [
    { id: 'e0', from: 'v', to: 'f' },
    { id: 'e1', from: 'm', to: 'f' },
    { id: 'e2', from: 'f', to: 'c' },
    { id: 'e3', from: 'c', to: 'x', label: 'no' },
    { id: 'e4', from: 'x', to: 'f', label: 'fix' },
    { id: 'e5', from: 'c', to: 'k', label: 'yes' },
    { id: 'e6', from: 'k', to: 'l' },
    { id: 'e7', from: 'm', to: 'l', label: 'audit' },
  ],
};

test('the player check gives the SVG check findings while an auto-layout arc widens the figure', { skip: !browser.path }, async () => {
  const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
window.show = () => createRoot(document.getElementById('root')).render(createElement(Flow, { ...${JSON.stringify(busy)}, check: true }));
`;
  const svg = check(busy).map((f) => `flowfig check: ${f.severity} ${f.rule}: ${f.message}`);
  await withReactPage(entry, async ({ ev, until, load }) => {
    for (const width of [830, 390]) {
      await load(width);
      await until('!!window.show', 'the page loads');
      await ev('show()');
      await until(`document.querySelectorAll('path[fill=none][stroke-width]').length === 8`, 'the player draws every edge');
      await new Promise((r) => setTimeout(r, 300));
      const player = (await ev(`pageErrors.splice(0).map((m) => m.replace('console.warn: ', ''))`)) as string[];
      assert.deepEqual(player, svg, `the player check at ${width} px`);
    }
  });
});
