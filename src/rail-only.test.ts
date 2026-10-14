import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import fig from '/figures/checkout.ts';
const steps = fig.props.steps.map((s) => ({ ...s, flow: s.flow.map((b) => ({ ...b, ms: 3000 })) }));
createRoot(document.getElementById('root')).render(createElement(Flow, { ...fig.props, steps, rail: 'only' }));
`;

test(
  'a rail-only figure on a phone keeps 11 px rail text in a pane that scrolls and follows the step',
  { skip: !browser.path },
  async () => {
    await withReactPage(entry, async ({ ev, until, load }) => {
      const pane = `document.querySelector('[data-rail-row]').closest('div')`;
      const now = `document.querySelector('[data-rail-row][data-state="now"]')`;
      await load(390);
      await until(
        `!!document.querySelector('[data-rail-row]') && ${pane}.scrollWidth > ${pane}.clientWidth`,
        'the rail pane scrolls sideways',
      );
      const smallest =
        await ev(`(() => { const svg = ${pane}.firstElementChild, k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return Math.min(...[...svg.querySelectorAll('text')].filter((t) => t.textContent.trim()).map((t) => parseFloat(getComputedStyle(t).fontSize) * k)); })()`);
      assert.ok(smallest >= 11 - 0.01, `the smallest rail text is ${smallest} px`);
      assert.ok(
        !(await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth')),
        'the page does not scroll sideways',
      );
      await ev(`document.querySelectorAll('[role="tab"]')[2].click()`);
      await until(
        `(() => { const p = ${pane}.getBoundingClientRect(), r = ${now}.querySelector('path').getBoundingClientRect(); return ${pane}.scrollLeft > 0 && r.left >= p.left && r.right <= p.right; })()`,
        'the active message is in view after a step change',
      );
    });
  },
);
