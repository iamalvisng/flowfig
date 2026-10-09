import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, withReactPage } from './react-page.ts';
import { render } from './svg.ts';
import type { FigGroup, FigNode, FlowProps } from './model.ts';
import orderStatus from '../figures/order-status.ts';

const row: FlowProps = {
  layout: {
    direction: 'row',
    children: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', mark: 'start' },
      { id: 'c', label: 'C', mark: 'end' },
      { id: 'd', label: 'D' },
    ],
  },
  edges: [
    { id: 'ab', from: 'a', to: 'b' },
    { id: 'bc', from: 'b', to: 'c' },
    { id: 'cd', from: 'c', to: 'd' },
  ],
  steps: [{ label: 'go', flow: [{ edges: 'bc', say: 'B sends to C.' }] }],
};
const specs = [orderStatus.props as FlowProps, row];

const side = (c: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) =>
  c.x < b.x ? 'l' : c.x > b.x + b.w ? 'r' : c.y < b.y ? 't' : c.y > b.y + b.h ? 'b' : 'in';
const marked = (n: FigGroup | FigNode): string[] => ('children' in n ? n.children.flatMap(marked) : 'mark' in n && n.mark ? [n.id] : []);

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
const specs = ${JSON.stringify(specs)};
createRoot(document.getElementById('root')).render(specs.map((s, i) => createElement(Flow, { ...s, key: i })));
`;

function svgSides(spec: FlowProps): Record<string, string> {
  const { svg, scene } = render(spec);
  const dots = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="(?:5|6\.25)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const ids = marked(spec.layout);
  const out: Record<string, string> = {};
  for (const { id, rect: b } of scene.boxes.filter((b) => ids.includes(b.id))) {
    const c = dots.reduce((p, d) =>
      Math.hypot(d.x - b.x - b.w / 2, d.y - b.y - b.h / 2) < Math.hypot(p.x - b.x - b.w / 2, p.y - b.y - b.h / 2) ? d : p,
    );
    out[id] = side(c, b);
  }
  return out;
}

test('the player draws each start and end mark on the same box side as the SVG', { skip: !browser.path }, async () => {
  const want = Object.assign({}, ...specs.map(svgSides));
  assert.deepEqual(Object.keys(want).sort(), ['b', 'c', 'cancelled', 'delivered', 'new'], 'the SVG draws every mark');
  await withReactPage(entry, async ({ ev, until, load }) => {
    await load(1200);
    const marks = `[...document.querySelectorAll('[data-fig] > span[aria-hidden]')]`;
    await until(`${marks}.length >= 5`, 'the player draws five marks');
    await new Promise((r) => setTimeout(r, 300));
    const got = await ev(`Object.fromEntries(${marks}.map((m) => {
      const r = (e) => { const q = e.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
      const d = r(m), b = r(m.parentElement);
      return [m.parentElement.dataset.fig, (${side})({ x: d.x + d.w / 2, y: d.y + d.h / 2 }, b)];
    }))`);
    assert.deepEqual(got, want);
  });
});
