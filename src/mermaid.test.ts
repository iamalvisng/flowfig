import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMermaid } from './mermaid.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');

const inTemp = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a flowchart keeps its shapes, edge labels and subgraph frame', () => {
  const r = fromMermaid(`flowchart LR
    %% comment
    U([User]) -->|submit| api["Auth API"]:::hot
    subgraph auth [Auth service]
      api --> V{Valid #quot;pw#quot;?}
      V -- yes --> S[(Session<br/>store)]
    end
    V -.-> U & api
    classDef hot fill:#f00`);
  assert.deepEqual(r.spec, {
    layout: {
      auto: true,
      direction: 'row',
      children: [
        { id: 'U', label: 'User' },
        {
          id: 'auth',
          label: 'Auth service',
          children: [
            { id: 'api', label: 'Auth API' },
            { id: 'V', label: 'Valid "pw"?', shape: 'decision' },
            { id: 'S', label: 'Session store', shape: 'store' },
          ],
        },
      ],
    },
    edges: [
      { from: 'U', to: 'api', label: 'submit' },
      { from: 'api', to: 'V' },
      { from: 'V', to: 'S', label: 'yes' },
      { from: 'V', to: 'U' },
      { from: 'V', to: 'api' },
    ],
  });
});

test('a sequence gives one hop per message, with replies back on the same edge and async marked', () => {
  const r = fromMermaid(`sequenceDiagram
    participant W as Web app
    W->>+A: POST /login
    loop retry
      A-->>-W: 200 cookie
    end
    A-)Q: user.logged_in`);
  assert.deepEqual(r.spec?.edges, [
    { from: 'W', to: 'A' },
    { from: 'A', to: 'Q' },
  ]);
  assert.equal(r.spec?.rail, 'only');
  assert.deepEqual(r.spec?.steps?.[0].flow, [
    { edge: 'W->A', data: 'POST /login' },
    { edge: 'W->A', back: true, data: '200 cookie' },
    { edge: 'A->Q', async: true, data: 'user.logged_in' },
  ]);
});

test('each alt branch becomes its own step, with the messages around the alt', () => {
  const r = fromMermaid(`sequenceDiagram
    C->>S: checkout
    alt card ok
      S-->>C: 201 placed
    else
      S-->>C: 402 failed
    end
    C->>S: poll`);
  assert.deepEqual(
    r.spec?.steps?.map((s) => [s.label, s.flow.map((h) => (h as { data: string }).data)]),
    [
      ['card ok', ['checkout', '201 placed', 'poll']],
      ['branch 2', ['checkout', '402 failed', 'poll']],
    ],
  );
});

test('a long run of spaces in a link fails fast', () => {
  const start = performance.now();
  fromMermaid(`graph TD\nA -- ${' '.repeat(4000)}x`);
  assert.ok(performance.now() - start < 1000);
});

test('an unknown line exits 1 with its file line and writes no spec', () =>
  inTemp((dir) => {
    const file = join(dir, 'a.mmd');
    writeFileSync(file, 'graph TD\n  A --> B\n  A <--> C\n');
    const r = spawnSync(process.execPath, [cli, 'from-mermaid', file, '--out', join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${file.replace(/[\\.]/g, '\\$&')}:3: `));
    assert.equal(existsSync(join(dir, 'out', 'a.json')), false);
  }));

test('a Markdown file with two mermaid blocks gives two specs', () =>
  inTemp((dir) => {
    const file = join(dir, 'doc.md');
    writeFileSync(file, '# Doc\n\n```mermaid\ngraph TD\n  A --> B\n```\n\ntext\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n');
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, [cli, 'from-mermaid', file, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['doc-1.json', 'doc-2.json']);
    assert.equal(JSON.parse(readFileSync(join(out, 'doc-2.json'), 'utf8')).rail, 'only');
  }));
