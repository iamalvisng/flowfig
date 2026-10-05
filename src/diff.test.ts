import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, formatDiff } from './diff.ts';
import type { FlowProps } from './model.ts';

const base: FlowProps = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'API', sub: 'v1' },
      { id: 'c', label: 'DB' },
    ],
  },
  edges: [
    { id: 'q', from: 'a', to: 'b', label: 'GET' },
    { from: 'b', to: 'c' },
  ],
  steps: [
    { label: 'read', flow: ['q', 'b->c', { edge: 'q', back: true, data: '200' }] },
    { label: 'old', flow: ['q'] },
  ],
};

test('diff finds boxes, edges, steps, messages and the rail', () => {
  const next: FlowProps = {
    rail: true,
    layout: {
      children: [
        { id: 'a', label: 'Browser' },
        { id: 'b', label: 'API', sub: 'v1' },
        { id: 'd', label: 'Cache' },
      ],
    },
    edges: [
      { id: 'q', from: 'a', to: 'b', label: 'POST', source: 'x.ts' },
      { from: 'b', to: 'd' },
    ],
    steps: [
      { label: 'read', flow: ['q', 'b->d', { edge: 'q', back: true, data: '201' }] },
      { label: 'new', flow: ['q'] },
    ],
  };
  assert.deepEqual(diff(base, next), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'label "Client" -> "Browser"' },
    { kind: 'box', op: 'removed', id: 'c' },
    { kind: 'box', op: 'added', id: 'd' },
    { kind: 'edge', op: 'changed', id: 'q', detail: 'label "GET" -> "POST"; source (none) -> "x.ts"' },
    { kind: 'edge', op: 'removed', id: 'b->c' },
    { kind: 'edge', op: 'added', id: 'b->d' },
    { kind: 'step', op: 'removed', id: 'old' },
    { kind: 'step', op: 'added', id: 'new' },
    { kind: 'message', op: 'removed', id: 'read: b->c' },
    { kind: 'message', op: 'removed', id: 'read: q back "200"' },
    { kind: 'message', op: 'removed', id: 'old: q' },
    { kind: 'message', op: 'added', id: 'read: b->d' },
    { kind: 'message', op: 'added', id: 'read: q back "201"' },
    { kind: 'message', op: 'added', id: 'new: q' },
    { kind: 'rail', op: 'changed', id: 'rail', detail: '(none) -> true' },
  ]);
});

test('a box that moves to another group is a change', () => {
  const a = { id: 'a', label: 'A' };
  const b = { id: 'b', label: 'B' };
  const at = (children: FlowProps['layout']['children']): FlowProps => ({ layout: { children }, edges: [{ from: 'a', to: 'b' }] });
  assert.deepEqual(diff(at([a, { label: 'Zone', children: [b] }]), at([{ label: 'Zone', children: [a, b] }])), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'group (none) -> "Zone"' },
  ]);
});

test('a hop tone and a box tone are changes', () => {
  const toned: FlowProps = {
    ...base,
    layout: { children: [{ id: 'a', label: 'Client', tone: 'red' }, ...base.layout.children.slice(1)] },
    steps: [{ label: 'read', flow: ['q', 'b->c', { edge: 'q', back: true, data: '200', tone: 'green' }] }, base.steps![1]],
  };
  assert.deepEqual(diff(base, toned), [
    { kind: 'box', op: 'changed', id: 'a', detail: 'tone (none) -> "red"' },
    { kind: 'message', op: 'removed', id: 'read: q back "200"' },
    { kind: 'message', op: 'added', id: 'read: q back "200" [green]' },
  ]);
});

test('a from or to change is a box change', () => {
  const a: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-05', to: '2026-10-09' }] }, edges: [] };
  const b: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-06', to: '2026-10-09' }] }, edges: [] };
  assert.deepEqual(diff(a, b), [{ kind: 'box', op: 'changed', id: 'x', detail: 'from "2026-10-05" -> "2026-10-06"' }]);
  const c: FlowProps = { layout: { children: [{ id: 'x', label: 'X', from: '2026-10-05' }] }, edges: [] };
  assert.equal(diff(a, c)[0].detail, 'to "2026-10-09" -> (none)');
  const marked = structuredClone(base);
  (marked.layout as { children: { mark?: string }[] }).children[0].mark = 'start';
  const out = diff(base, marked);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'box');
});

test('diff reports a via change, a removed repeated hop and a caption change', () => {
  const base: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'q', from: 'a', to: 'b', via: 'order-paid' }],
    steps: [{ label: 'pay', caption: 'The order is paid.', flow: ['q', 'q'] }],
  };
  const next: FlowProps = {
    ...base,
    edges: [{ id: 'q', from: 'a', to: 'b', via: 'order-shipped' }],
    steps: [{ label: 'pay', caption: 'The order ships.', flow: ['q'] }],
  };
  const lines = formatDiff(diff(base, next), 'text');
  assert.match(lines, /edge changed: q \(via "order-paid" -> "order-shipped"\)/);
  assert.match(lines, /message removed/);
  assert.match(lines, /step changed: pay \(caption/);
});
