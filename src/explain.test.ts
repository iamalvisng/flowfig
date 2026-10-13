import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FlowProps } from './model.ts';
import { cast, moments, parcel } from './explain.ts';
import oil from '../figures/explain-oil.ts';
import sync from '../figures/explain-sync.ts';
import before from '../figures/explain-delivery-before.ts';
import after from '../figures/explain-delivery-after.ts';

test('the actor of the target box of the last edge in a beat acts in that moment', () => {
  const actors = moments(oil.props, 'Normal pickup')
    .slice(0, 6)
    .map((m) => m.actor);
  assert.deepEqual(actors, ['Office', 'Office', 'Worker', 'Worker', 'Server', 'Customer']);
});

test('a beat that leaves a decision stamps the card with the edge label, and a dead end gets ✗', () => {
  const pickup = moments(oil.props, 'Normal pickup');
  assert.equal(pickup[0].stamp, undefined);
  assert.deepEqual(pickup[4].stamp, { mark: '✓', label: 'yes' });
  assert.deepEqual(moments(oil.props, 'Too many requests')[0].stamp, { mark: '✗', label: 'no' });
  assert.deepEqual(moments(oil.props, 'Expired certification')[2].stamp, { mark: '✗', label: 'expired' });
});

test('a decision stamp carries the question it answers', () => {
  assert.equal(moments(oil.props, 'Expired certification')[0].question, 'Worker free?');
  assert.equal(moments(sync.props, 'Sent twice')[1].question, 'Saved before?');
});

test('the card names the first box of the first step, or "Request" when that label reads as an action', () => {
  assert.equal(parcel(sync.props), 'Worker app');
  assert.equal(parcel(oil.props), 'Request');
});

test('each edge into a store files one card to Records: the data, else the edge label, else the store label', () => {
  const good = moments(sync.props, 'Good record');
  assert.deepEqual(good[0].records, []);
  assert.deepEqual(good[2].records, ['commit']);
  assert.deepEqual(good[3].records, ['Push queue']);
  const delivered = moments(after.props, 'Delivered');
  assert.deepEqual(delivered[1].records, ['completed', 'history row']);
  assert.deepEqual(delivered[3].records, ['status delivered']);
});

test('only the last moment of a step holds the summary, with the label of the box where the step ends', () => {
  const pickup = moments(oil.props, 'Normal pickup');
  assert.equal(pickup.at(-1)?.summary?.outcome, 'Gets paid');
  assert.equal(pickup.slice(0, -1).filter((m) => m.summary).length, 0);
  assert.equal(moments(oil.props, 'Too many requests').at(-1)?.summary?.outcome, 'Told: too many requests');
});

test('the summary lists as not reached the boxes that other steps reach and this step does not', () => {
  const refused = moments(oil.props, 'Too many requests').at(-1)?.summary?.notReached ?? [];
  for (const label of ['Accept the request', 'Told: no worker free', 'Gets paid']) assert.ok(refused.includes(label), label);
  for (const label of ['Under the limit?', 'Told: too many requests']) assert.ok(!refused.includes(label), label);
  const pickup = moments(oil.props, 'Normal pickup').at(-1)?.summary?.notReached ?? [];
  assert.ok(pickup.includes('Told: too many requests'));
  assert.ok(!pickup.includes('Gets paid'));
});

test('without a note, the short line names the next actor, and the last moment names the outcome', () => {
  const pickup = moments(oil.props, 'Normal pickup');
  assert.equal(pickup[1].note, 'Next: Worker');
  assert.equal(pickup.at(-1)?.note, 'Outcome: Gets paid');
  assert.equal(moments(oil.props, 'Expired certification')[0].note, 'The office does not see the certification.');
});

test('a beat with no say reads its edge label and the target box label', () => {
  const bare: FlowProps = {
    layout: {
      children: [
        { id: 'shop', label: 'Shop' },
        { id: 'bank', label: 'Bank' },
      ],
    },
    edges: [{ from: 'shop', to: 'bank', label: 'charge' }],
    steps: [{ label: 'Pay', flow: ['shop->bank'] }],
  };
  const { say } = moments(bare, 'Pay')[0];
  assert.match(say, /charge/);
  assert.match(say, /Bank/);
});

test('with lanes, the cast is the lanes in order, each with its look', () => {
  const actors = cast(oil.props);
  assert.deepEqual(
    actors.map((a) => [a.name, a.look]),
    [
      ['Customer', 'person'],
      ['Office', 'desk'],
      ['Worker', 'truck'],
      ['Server', 'server'],
    ],
  );
});

test('without lanes, the cast is the labeled top-level groups in order', () => {
  const actors = cast(before.props);
  assert.deepEqual(
    actors.filter((a) => a.name !== 'Records').map((a) => a.name),
    ['Driver app', 'Job orders API', 'Order listener', 'Pack ledger listener'],
  );
  assert.equal(actors[0].look, 'phone');
});

test('with no lanes and no labeled groups, the cast skips decision boxes, and a moment at a decision keeps the actor before it', () => {
  const plain: FlowProps = {
    layout: {
      children: [
        { id: 'app', label: 'App', look: 'phone' },
        { id: 'api', label: 'API' },
        { id: 'check', label: 'Valid?', shape: 'decision' },
        { id: 'db', label: 'Database', shape: 'store' },
      ],
    },
    edges: [
      { from: 'app', to: 'api' },
      { from: 'api', to: 'check' },
      { from: 'check', to: 'db', label: 'yes' },
    ],
    steps: [
      { label: 'Save', flow: ['app->api', 'api->check', 'check->db'] },
      { label: 'Recheck', flow: ['api->check'] },
    ],
  };
  assert.deepEqual(
    cast(plain).map((a) => [a.name, a.look]),
    [
      ['App', 'phone'],
      ['API', undefined],
      ['Records', undefined],
    ],
  );
  const save = moments(plain, 'Save');
  assert.deepEqual(
    save.map((m) => m.actor),
    ['API', 'API', 'Records', 'Records'],
  );
  assert.equal(save[0].note, 'Next: Records');
  assert.deepEqual(save[2].stamp, { mark: '✓', label: 'yes' });
  assert.equal(moments(plain, 'Recheck')[0].actor, 'API');
});

test('every store box joins one actor named Records', () => {
  const actors = cast(before.props);
  const records = actors.filter((a) => a.name === 'Records');
  assert.equal(records.length, 1);
  assert.deepEqual([...records[0].boxes].sort(), ['events', 'jobs', 'orders', 'packs']);
  for (const store of ['Job orders', 'Job order events', 'Sales orders', 'Pack movements'])
    assert.ok(!actors.some((a) => a.name === store), store);
  assert.equal(moments(sync.props, 'Good record')[3].actor, 'Records');
});
