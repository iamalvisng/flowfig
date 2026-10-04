import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, TOOLS } from './mcp.ts';
import { GUIDE } from './guide.ts';
import { VERSION } from './version.ts';

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
    const folder = call('check', { spec: dir });
    assert.equal(folder.result.isError, true);
    const missing = call('check', { spec: join(dir, 'nope.json') });
    assert.equal(missing.result.isError, true);
    assert.match(text(missing), /nope\.json: .*ENOENT/);
    const blocked = call('render', { spec: props, out: dir });
    assert.equal(blocked.result.isError, true);
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

test('verify goes on after a bad path, and a wrong argument type is -32602', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  try {
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ props }));
    const r = call('verify', { paths: [join(dir, 'gone.json'), join(dir, 'ok.json')], root: dir });
    assert.equal(r.result.isError, true);
    assert.match(text(r), /^error {4}missing-file {7}.*gone\.json: /);
    assert.match(text(r), /ok\.json: no box.*\n1 error, 1 warning\n.*ok\.json: 0 of 0 boxes defined$/);
    const code = (name: string, args: unknown) =>
      (handle(req(1, 'tools/call', { name, arguments: args })) as { error: { code: number } }).error.code;
    assert.equal(code('verify', { paths: 'a.json' }), -32602);
    assert.equal(code('check', { spec: props, width: 'wide' }), -32602);
    assert.equal(code('check', { spec: props, minText: -1 }), -32602);
    assert.equal(code('check', { spec: props, strict: 'yes' }), -32602);
    assert.equal(code('render', { spec: props, out: 5 }), -32602);
    assert.equal(code('verify', { paths: [], root: 5 }), -32602);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a notification gets no reply, and a protocolVersion that is not a string falls back', () => {
  assert.equal(handle({ jsonrpc: '2.0', method: 'ping' }), undefined);
  assert.equal(handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'docs' } }), undefined);
  const r = handle(req(1, 'initialize', { protocolVersion: 123 })) as { result: { protocolVersion: string } };
  assert.equal(r.result.protocolVersion, '2025-11-25');
});

test('the verify tool prints the box counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'export function a() {}\n// b\n');
    const children = [
      { id: 'a', label: 'Client', source: 'a.ts#a' },
      { id: 'b', label: 'Server', source: 'a.ts#b' },
    ];
    writeFileSync(join(dir, 'f.json'), JSON.stringify({ props: { ...props, layout: { children } } }));
    assert.match(text(call('verify', { paths: [join(dir, 'f.json')], root: dir })), /1 of 2 boxes defined/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the verify tool prints the findings in the order of the CLI verify', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  try {
    const linked = {
      ...props,
      layout: {
        children: [
          { id: 'a', label: 'Client', source: 'a.ts#nope' },
          { id: 'b', label: 'Server' },
        ],
      },
    };
    writeFileSync(join(dir, 'a.ts'), 'export const login = 1;');
    writeFileSync(join(dir, 'f.json'), JSON.stringify({ props: linked }));
    const tool = text(call('verify', { paths: [join(dir, 'f.json')], root: dir }));
    const cliOut = spawnSync('node', [cli, 'verify', join(dir, 'f.json'), '--root', dir], { encoding: 'utf8' }).stdout;
    assert.equal(tool, cliOut.trimEnd());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flowfig mcp loses no line when the reader is slow', async () => {
  const child = spawn('node', [cli, 'mcp']);
  child.stdout.pause();
  const call1 = JSON.stringify(req(1, 'tools/call', { name: 'docs', arguments: {} }));
  child.stdin.end(Array(50).fill(call1).join('\n') + '\n');
  await new Promise((r) => setTimeout(r, 500));
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
  child.stdout.resume();
  await new Promise((r) => child.on('close', r));
  assert.equal(out.trimEnd().split('\n').length, 50);
});

test('the CLI and the MCP server report the package.json version', () => {
  const pkg = JSON.parse(readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json'), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
