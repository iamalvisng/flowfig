import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';
import checkout from '../figures/checkout.ts';

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
window.errs = [];
window.addEventListener('error', (e) => errs.push('error: ' + e.message));
for (const m of ['error', 'warn']) {
  const f = console[m];
  console[m] = (...a) => (a.some((x) => String(x).includes('NaN')) && errs.push(m + ': ' + a.join(' ')), f(...a));
}
const host = document.getElementById('root');
host.style.display = 'none';
createRoot(host, { onUncaughtError: (e) => errs.push('uncaught: ' + e.message) }).render(
  createElement(Flow, { ...${JSON.stringify(checkout.props)}, check: true }),
);
`;

test('a checked player mounted in a hidden parent draws its boxes once the parent shows', { skip: !browser.path }, async () => {
  await withReactPage(entry, async ({ ev, until, load }) => {
    await load(1200);
    await new Promise((r) => setTimeout(r, 300));
    await ev(`document.getElementById('root').style.display = ''`);
    await until(`[...document.querySelectorAll('[data-fig]')].some((n) => n.getBoundingClientRect().width > 0)`, 'the boxes have width');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await ev('errs'), []);
  });
});
