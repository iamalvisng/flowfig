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

test('no change gives an empty list', () => {
  assert.deepEqual(diff(base, structuredClone(base)), []);
});

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

test('formatDiff prints one line per change, as text or Markdown', () => {
  const steps = [{ label: 'read', flow: ['q', { edge: 'q', back: true, data: '200' }] }, base.steps![1]];
  const c = diff(base, { ...base, edges: [base.edges[0]], steps });
  assert.equal(formatDiff(c, 'text'), 'edge removed: b->c\nmessage removed: read: b->c');
  assert.equal(formatDiff(c, 'md'), '- edge removed: `b->c`\n- message removed: `read: b->c`');
  assert.equal(formatDiff([], 'md'), '- no change in the spec');
});
