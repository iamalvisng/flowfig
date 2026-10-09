import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageLine, links, parseSource, verify, verifyReport } from './verify.ts';
import { checkSpec } from './check.ts';
import type { FlowProps } from './model.ts';

test('a source link must be path or path#symbol with no space', () => {
  assert.deepEqual(parseSource('src/a.ts'), { path: 'src/a.ts' });
  assert.deepEqual(parseSource('src/a.ts#f'), { path: 'src/a.ts', symbol: 'f' });
  for (const bad of ['', 'a.ts#', '#f', 'a b.ts', 'a.ts#f#g', 'a.ts#f g']) assert.equal(parseSource(bad), null, bad);
});

const withRepo = (files: Record<string, string>, run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), text);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const figWith = (source?: string): FlowProps => ({
  layout: {
    children: [
      { id: 'a', label: 'A', source },
      { id: 'b', label: 'B' },
    ],
  },
  edges: [{ from: 'a', to: 'b' }],
});
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

test('verify passes a present file and symbol, fails a missing file or symbol', () => {
  withRepo({ 'src/a.ts': 'export function login() {}\nconst $get = 1;' }, (root) => {
    assert.deepEqual(verify(figWith('src/a.ts#login'), { root }), []);
    assert.deepEqual(verify(figWith('src/a.ts'), { root }), []);
    assert.deepEqual(rules(verify(figWith('src/b.ts#login'), { root })), ['missing-file']);
    assert.deepEqual(rules(verify(figWith('src/a.ts#logout'), { root })), ['missing-symbol']);
    assert.deepEqual(rules(verify(figWith('src/a.ts#logi'), { root })), ['missing-symbol']);
    assert.deepEqual(verify(figWith('src/a.ts#$get'), { root }), []);
  });
});

test('a figure with no link is a warning; a path outside the root is a missing file', () => {
  withRepo({ 'src/a.ts': '' }, (root) => {
    assert.deepEqual(rules(verify(figWith(), { root })), ['no-source']);
    assert.deepEqual(rules(verify(figWith('../a.ts'), { root })), ['missing-file']);
    assert.deepEqual(rules(verify(figWith('/etc/hosts'), { root })), ['missing-file']);
  });
});

test('a link to a folder is a missing file, not a crash', () => {
  withRepo({ 'src/a.ts': '', '..x': '' }, (root) => {
    assert.deepEqual(rules(verify(figWith('src'), { root })), ['missing-file']);
    assert.deepEqual(verify(figWith('..x'), { root }), []);
  });
});

test('verify lists each well-formed link with the box, edge or hop that owns it', () => {
  const fig: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'A', source: 'x.ts#f' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'e', from: 'a', to: 'b', source: 'y.ts' }],
    steps: [
      {
        label: 's',
        flow: [{ edges: { edge: 'e', source: 'z.ts#g' } }, { edges: { edge: 'e', source: 'bad#' } }],
      },
    ],
  };
  assert.deepEqual(links(fig), [
    { owner: 'box "a"', source: 'x.ts#f', path: 'x.ts', symbol: 'f' },
    { owner: 'edge "e"', source: 'y.ts', path: 'y.ts' },
    { owner: 'hop on "e"', source: 'z.ts#g', path: 'z.ts', symbol: 'g' },
  ]);
});

test('a box symbol in a code file must be defined; a mention, a comment or a string is not enough', () => {
  withRepo(
    {
      'src/a.ts': 'export function login() {}\n// logout\nconst s = "reset";\nlogoutAll();\n',
      'docs/sop.md': '# Refund an order\n',
      'notes.txt': 'login',
    },
    (root) => {
      const run = (source: string) => verify(figWith(source), { root }).map((f) => f.message);
      assert.deepEqual(run('src/a.ts#login'), []);
      for (const s of ['logout', 'reset', 'logoutAll'])
        assert.deepEqual(run(`src/a.ts#${s}`), [`box "a" -> src/a.ts#${s}: symbol not defined`]);
      assert.deepEqual(run('docs/sop.md#refund-an-order'), []);
      assert.deepEqual(run('notes.txt#login'), []);
      assert.deepEqual(run('notes.txt#logout'), ['box "a" -> notes.txt#logout: symbol not found']);
    },
  );
});

test('verifyReport counts the boxes with a source and the boxes that pass', () => {
  withRepo({ 'src/a.ts': 'export function a() {}\n', 'img.png': '\x89PNG\r\n\x1a\n\0\0' }, (root) => {
    const fig: FlowProps = {
      layout: {
        children: [
          { id: 'a', label: 'A', source: 'src/a.ts#a' },
          { id: 'b', label: 'B', source: 'src/a.ts#b' },
          { id: 'c', label: 'C', source: 'img.png#x' },
          { id: 'd', label: 'D' },
        ],
      },
      edges: [],
    };
    const r = verifyReport(fig, { root });
    assert.deepEqual({ boxes: r.coverage.boxes, boxesDefined: r.coverage.boxesDefined }, { boxes: 3, boxesDefined: 1 });
    assert.equal(coverageLine('docs/f.svg', r.coverage), 'docs/f.svg: 1 of 3 boxes defined');
  });
});

test('verifyReport reads the file again on each call, so a fixed file passes', () => {
  withRepo({ 'a.ts': '// login\n' }, (root) => {
    const run = () => verifyReport(figWith('a.ts#login'), { root }).coverage.boxesDefined;
    assert.equal(run(), 0);
    writeFileSync(join(root, 'a.ts'), 'export function login() {}\n');
    assert.equal(run(), 1);
  });
});

test('verifyReport gives each edge a result and warns on an edge that is not found', () => {
  withRepo(
    {
      'src/auth.ts': 'export function verify() {}\nexport function reset() {}\n',
      'src/login.ts': "import { verify } from './auth.ts';\nexport function login() { verify(); }\n",
    },
    (root) => {
      const fig: FlowProps = {
        layout: {
          children: [
            { id: 'l', label: 'Login', source: 'src/login.ts#login' },
            { id: 'v', label: 'Verify', source: 'src/auth.ts#verify' },
            { id: 'r', label: 'Reset', source: 'src/auth.ts#reset' },
            { id: 'u', label: 'User' },
          ],
        },
        edges: [
          { from: 'l', to: 'v' },
          { from: 'l', to: 'r' },
          { from: 'u', to: 'l' },
        ],
      };
      const r = verifyReport(fig, { root });
      assert.deepEqual(
        { found: r.coverage.found, notFound: r.coverage.notFound, notChecked: r.coverage.notChecked },
        { found: 1, notFound: 1, notChecked: 1 },
      );
      assert.deepEqual(
        r.findings.map((f) => [f.rule, f.severity]),
        [['edge-not-found', 'warning']],
      );
    },
  );
});

test('a back hop with no own source takes its caller from the box it leaves, not from the edge source', () => {
  withRepo(
    {
      'src/client.ts': "export function callB() { bus.on('reply', handle); bus.send('ask'); }\nexport function handle() {}\n",
      'src/server.ts': "export function serve() { bus.on('ask', go); }\n",
    },
    (root) => {
      const fig: FlowProps = {
        layout: {
          children: [
            { id: 'c', label: 'Client', source: 'src/client.ts#handle' },
            { id: 's', label: 'Server', source: 'src/server.ts#serve' },
          ],
        },
        edges: [{ id: 'e', from: 'c', to: 's', source: 'src/client.ts#callB', via: 'ask' }],
        steps: [{ label: 'x', flow: [{ edges: [{ edge: 'e', back: true, via: 'reply' }] }] }],
      };
      const r = verifyReport(fig, { root });
      assert.deepEqual(
        r.findings.map((f) => f.message),
        ['hop on "e": "reply" is not in serve'],
      );
    },
  );
});

test('a via that is not a string is a bad source for check, and verify does not crash on it', () => {
  const fig = {
    layout: {
      children: [
        { id: 'a', label: 'A', source: 'src/a.ts#send' },
        { id: 'c', label: 'C', source: 'src/c.ts#recv' },
      ],
    },
    edges: [{ from: 'a', to: 'c', via: 42 as unknown as string }],
  };
  assert.deepEqual(
    checkSpec(fig).map((f) => f.rule),
    ['bad-source'],
  );
  withRepo({ 'src/a.ts': 'export function send() {}\n', 'src/c.ts': 'export function recv() {}\n' }, (root) => {
    assert.equal(verifyReport(fig, { root }).coverage.notChecked, 1);
  });
});

test('a client call such as axios.get("/x", cfg) does not define a symbol', () => {
  withRepo({ 'src/c.ts': 'export async function load() {\n  return axios.get("/x", cfg);\n}\n' }, (root) => {
    assert.deepEqual(rules(verify(figWith('src/c.ts#/x'), { root })), ['missing-symbol']);
  });
});

test('Owner.name finds an enum member and not a name that is no member', () => {
  const enums: Record<string, [string, string]> = {
    'a.ts': ['export enum Owner { Pending = "p", Paid, Shipped = 3 }\n// Ghost\nconst s = "Ghost";\n', 'Paid'],
    'b.java': ['enum Owner { PENDING, PAID("x"), SHIPPED; int n; }\n// GHOST\n', 'PAID'],
    'c.cs': ['enum Owner { Pending, Paid = 1 }\n// Ghost\n', 'Paid'],
    'd.rs': ['enum Owner { Pending, Paid(u8), Shipped { at: u8 } }\n// Ghost\n', 'Shipped'],
    'e.py': ['class Owner(Enum):\n    PENDING = 1\n    PAID = 2\n# GHOST\n', 'PAID'],
  };
  withRepo(Object.fromEntries(Object.entries(enums).map(([f, [text]]) => [`src/${f}`, text])), (root) => {
    for (const [f, [, member]] of Object.entries(enums)) {
      const run = (n: string) => verify(figWith(`src/${f}#Owner.${n}`), { root }).map((x) => x.rule);
      assert.deepEqual(run(member), [], f);
      assert.deepEqual(run(member.toUpperCase() === member ? 'GHOST' : 'Ghost'), ['missing-symbol'], f);
    }
  });
});

test('missing-detail warns for a missing file, an SVG with no spec and a figure with no source', () => {
  withRepo({ 'docs/plain.svg': '<svg/>' }, (root) => {
    const fig = (detail: string): FlowProps => ({ layout: { children: [{ id: 'a', label: 'A', detail }] }, edges: [] });
    for (const detail of ['docs/gone.svg', 'docs/plain.svg', '../x.svg']) {
      const found = verifyReport(fig(detail), { root }).findings;
      assert.deepEqual(rules(found), ['missing-detail', 'no-source'], detail);
      assert.equal(found[0].severity, 'warning');
    }
  });
});

test('a box symbol that its file re-exports counts as defined', () => {
  const forms: Record<string, string> = {
    named: "export { getUser } from './user';",
    star: "export * from './user';",
    namespace: "export * as getUser from './user';",
    default: "export { default as getUser } from './user';",
    renamed: "export { fetchUser as getUser } from './user';",
    local: "import { getUser } from './user';\nexport { getUser };",
  };
  const user = 'export function getUser() {}\nexport function fetchUser() {}\nexport default function loadUser() {}';
  withRepo({ 'src/user.ts': user, ...Object.fromEntries(Object.entries(forms).map(([k, v]) => [`src/${k}.ts`, v])) }, (root) => {
    for (const k of Object.keys(forms)) {
      const r = verifyReport(figWith(`src/${k}.ts#getUser`), { root });
      assert.deepEqual([rules(r.findings), r.coverage.boxesDefined], [[], 1], k);
    }
  });
});

test('a re-export gives missing-symbol if no target defines the name, and no error if a target is a package', () => {
  withRepo(
    {
      'src/user.ts': 'export function fetchUser() {}',
      'src/a.ts': "export * from './user';",
      'src/b.ts': "export { getUser } from 'some-pkg';",
      'src/c.ts': "export * as getUser from './gone';",
    },
    (root) => {
      assert.deepEqual(rules(verify(figWith('src/a.ts#getUser'), { root })), ['missing-symbol']);
      const r = verifyReport(figWith('src/b.ts#getUser'), { root });
      assert.deepEqual([rules(r.findings), r.coverage.boxesDefined], [[], 0]);
      const gone = verifyReport(figWith('src/c.ts#getUser'), { root });
      assert.deepEqual([rules(gone.findings), gone.coverage.boxesDefined], [[], 0]);
    },
  );
});
