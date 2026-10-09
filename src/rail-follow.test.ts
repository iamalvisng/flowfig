import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import fig from '/figures/checkout.ts';
const steps = fig.props.steps.map((s) => ({ ...s, flow: s.flow.map((b, i) => ({ ...b, ms: i ? 1000 : 3000 })) }));
createRoot(document.getElementById('root')).render(createElement(Flow, { ...fig.props, steps }));
`;

test(
  'the narrow rail pane follows the active message until the reader scrolls it, and a tab click restores it',
  { skip: !browser.path },
  async () => {
    await withReactPage(entry, async ({ send, ev, until, load }) => {
      const pane = `document.querySelector('[data-rail-row]').closest('div')`;
      const now = `document.querySelector('[data-rail-row][data-state="now"]')`;
      const inView = `(() => { const p = ${pane}.getBoundingClientRect(), r = ${now}.querySelector('path').getBoundingClientRect();
      return r.left >= p.left && r.right <= p.right; })()`;
      const settled = async () => {
        let last = -1;
        for (let x = await ev(`${pane}.scrollLeft`); x !== last; x = await ev(`${pane}.scrollLeft`)) {
          last = x;
          await new Promise((r) => setTimeout(r, 200));
        }
        return last;
      };
      const follows = async (i: number, what: string) => {
        await ev(`document.querySelectorAll('[role="tab"]')[${i}].click()`);
        await until(`${now}.dataset.railRow === '${await ev(`${now}.dataset.railRow`)}' && ${inView}`, what);
      };

      await load(390);
      await until(`!!document.querySelector('[data-rail-row]') && ${pane}.scrollWidth > ${pane}.clientWidth`, 'the rail pane scrolls');

      await follows(1, 'the pane shows the first pay message');
      const before = await settled();

      const p = await ev(
        `(() => { ${pane}.scrollIntoView({ block: 'center' }); const r = ${pane}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
      );
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 5000, deltaY: 0 });
      const swiped = await settled();
      assert.notEqual(swiped, before, 'the wheel scrolls the pane');
      for (const beat of ['the webhook', 'the reply']) {
        const row = await ev(`${now}.dataset.railRow`);
        await until(`${now}.dataset.railRow !== '${row}'`, `${beat} beat starts`);
      }
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(await ev(`${pane}.scrollLeft`), swiped, 'a later beat does not move a pane the reader scrolled');

      await follows(0, 'the pane follows again after a tab click');
    });
  },
);
