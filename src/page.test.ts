import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgWithSpec } from './load.ts';
import type { FlowProps } from './model.ts';
import { pageHtml } from './page.ts';

const PROPS: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'Server' },
    ],
  },
  edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
  steps: [{ label: 'write', flow: [{ edges: 'w' }] }],
};

test('pageHtml escapes the title', () => {
  assert.match(pageHtml('<svg></svg>', 'a<b>&"c".svg'), /<title>a&lt;b&gt;&amp;&quot;c&quot;\.svg<\/title>/);
});

test('pageHtml keeps the SVG text and its spec unchanged', () => {
  const svg = svgWithSpec(PROPS);
  const page = pageHtml(svg, 'x.svg');
  assert.ok(page.startsWith('<!doctype html>'));
  assert.ok(page.includes(svg));
  assert.match(page, /<metadata id="figure-spec"><!\[CDATA\[/);
  // A $ pattern in the SVG stays as it is: the page does not use String.replace on the SVG.
  assert.ok(pageHtml('<svg>$& $1 $$</svg>', 'x.svg').includes('<svg>$& $1 $$</svg>'));
});

test('the page has no script', () => {
  assert.doesNotMatch(pageHtml(svgWithSpec(PROPS), 'x.svg'), /<script/i);
});
