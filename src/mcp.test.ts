import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, TOOLS } from './mcp.ts';
import { GUIDE } from './guide.ts';

const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'cli.js');
const props = {
  layout: {
    children: [
      { id: 'a', label: 'Client' },
      { id: 'b', label: 'Server', shape: 'store' },
    ],
  },
  edges: [{ id: 'w', from: 'a', to: 'b', label: 'write' }],
  steps: [{ label: 'write', flow: ['w'] }],
};
const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, params });
const call = (name: string, args: unknown) =>
  handle(req(1, 'tools/call', { name, arguments: args })) as { result: { content: { text: string }[]; isError?: boolean } };
const text = (r: ReturnType<typeof call>) => r.result.content[0].text;

test('initialize echoes the version, initialized gets no reply, discover lists the new version', () => {
  const r = handle(req(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })) as {
    result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } };
  };
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, 'flowfig');
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.deepEqual((handle(req(2, 'ping')) as { result: object }).result, {});
  const d = handle(req(3, 'server/discover', {})) as { result: { supportedVersions: string[] } };
  assert.deepEqual(d.result.supportedVersions, ['2026-07-28']);
});

test('tools/list names the five tools; an unknown method or tool is a JSON-RPC error', () => {
  const r = handle(req(1, 'tools/list')) as { result: { tools: { name: string }[] } };
  assert.deepEqual(
    r.result.tools.map((t) => t.name),
    ['docs', 'check', 'render', 'verify', 'diff'],
  );
  assert.equal(r.result.tools, TOOLS);
  assert.equal((handle(req(1, 'nope')) as { error: { code: number } }).error.code, -32601);
  assert.equal((handle(req(1, 'tools/call', { name: 'nope', arguments: {} })) as { error: { code: number } }).error.code, -32602);
  assert.equal(
    (handle(req(1, 'tools/call', { name: 'render', arguments: { spec: props } })) as { error: { code: number; message: string } }).error
      .message,
    'render: out is required',
  );
  assert.equal((handle('not an object') as { error: { code: number } }).error.code, -32600);
});

test('docs returns the guide; check reports a good and a bad spec', () => {
  assert.equal(text(call('docs', {})), GUIDE);
  const good = call('check', { spec: props });
  assert.equal(good.result.isError, undefined);
  assert.match(text(good), /0 errors, 0 warnings\nfigure: 2 boxes/);
  const bad = call('check', { spec: { ...props, edges: [{ id: 'w', from: 'a', to: 'zzz' }] } });
  assert.equal(bad.result.isError, true);
  assert.match(text(bad), /unknown-id/);
  const strict = call('check', { spec: { ...props, theme: { font: 'Comic Sans' } }, strict: true });
  assert.equal(strict.result.isError, true);
  const e = handle(req(1, 'tools/call', { name: 'check', arguments: { spec: { edges: [] } } })) as {
    error: { code: number; message: string };
  };
  assert.equal(e.error.code, -32602);
  assert.match(e.error.message, /no figure props/);
});

test('render writes the SVG with its spec, creates the folder, and writes nothing on an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  try {
    const out = join(dir, 'sub', 'out.svg');
    const r = call('render', { spec: props, out });
    assert.equal(r.result.isError, undefined);
    assert.match(text(r), new RegExp(`0 errors, 0 warnings\\nfigure: .*\\n${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — [\\d.]+ kB$`));
    assert.match(readFileSync(out, 'utf8'), /<metadata id="figure-spec">/);
    const bad = call('render', { spec: { ...props, edges: [{ id: 'w', from: 'a', to: 'zzz' }] }, out: join(dir, 'bad.svg') });
    assert.equal(bad.result.isError, true);
    assert.equal(existsSync(join(dir, 'bad.svg')), false);
    const e = handle(req(1, 'tools/call', { name: 'check', arguments: { spec: dir } })) as { error: { code: number } };
    assert.equal(e.error.code, -32602);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify and diff run on files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'export const login = 1;');
    const linked = { ...props, edges: [{ id: 'w', from: 'a', to: 'b', label: 'write', source: 'a.ts#login' }] };
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ props: linked }));
    const ok = call('verify', { paths: [join(dir, 'ok.json')], root: dir });
    assert.equal(ok.result.isError, undefined);
    assert.match(text(ok), /0 errors, 0 warnings/);
    const stale = call('verify', { paths: [join(dir, 'ok.json')], root: join(dir, 'sub') });
    assert.equal(stale.result.isError, true);
    assert.match(text(stale), /missing-file/);
    const d = call('diff', { old: props, new: linked });
    assert.equal(text(d), '- edge changed: `w` (source (none) -> "a.ts#login")');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flowfig mcp answers one line per request on stdout, and exits when stdin closes', () => {
  const lines = [
    JSON.stringify(req(0, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } })),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    '{not json',
    JSON.stringify(req(1, 'tools/list')),
  ];
  const r = spawnSync('node', [cli, 'mcp'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 0);
  assert.equal(out[1].error.code, -32700);
  assert.equal(out[2].result.tools.length, 5);
});
