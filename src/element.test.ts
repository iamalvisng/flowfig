import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { findBrowser, launch, type Cdp } from './browser.ts';
import { diff, toSvg } from './svg.ts';
import oil from '../figures/explain-oil.ts';
import sync from '../figures/explain-sync.ts';
import deliveryBefore from '../figures/explain-delivery-before.ts';
import deliveryAfter from '../figures/explain-delivery-after.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const specs: Record<string, object> = {
  oil: oil.props,
  sync: sync.props,
  'delivery-before': deliveryBefore.props,
  'delivery-after': deliveryAfter.props,
};
const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });
const pages = new Map<string, string>();
let server: Server;
let origin = '';
let cdp: Cdp;
let close: () => Promise<void>;
let dir = '';

before(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const spec = /^\/spec\/([\w-]+)\.json$/.exec(path)?.[1];
    const file = path.startsWith('/dist/') ? join(dist, normalize(path.slice(6))) : '';
    if (pages.has(path)) res.writeHead(200, { 'content-type': 'text/html' }).end(pages.get(path));
    else if (spec && specs[spec]) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(specs[spec]));
    else if (file.startsWith(dist) && existsSync(file)) res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(file));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (!browser.path) return;
  dir = mkdtempSync(join(tmpdir(), 'element-'));
  ({ cdp, close } = await launch(browser.path, join(dir, 'profile'), 120_000));
});

after(async () => {
  server?.close();
  await close?.();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function open(body: string, ready: string) {
  const path = `/page-${pages.size}`;
  pages.set(path, `<!doctype html><body><script type="module" src="/dist/element.js"></script>${body}</body>`);
  const { targetId } = await cdp.send('Target.createTarget', { url: origin + path });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m: string, p?: object) => cdp.send(m, p, sessionId);
  const ev = async (e: string) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (e: string, what: string, ms = 5000) => {
    for (let t = Date.now(); !(await ev(e).catch(() => false)); await new Promise((r) => setTimeout(r, 50)))
      assert.ok(Date.now() - t < ms, what);
  };
  await until(`!!customElements.get('flowfig-explain')`, 'the page defines <flowfig-explain>');
  await until(ready, 'the element shows its first view');
  return { send, ev, until, done: () => cdp.send('Target.closeTarget', { targetId }) };
}

const el = `document.querySelector('flowfig-explain')`;
const sr = `${el}.shadowRoot`;
const live = `(${sr}?.querySelector('[aria-live="polite"]')?.textContent ?? '')`;
const button = (name: string) =>
  `[...${sr}.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).trim().includes(${JSON.stringify(name)}))`;
const sleep = `new Promise((r) => setTimeout(r, 700))`;
const guide = (spec: string) => `<flowfig-explain src="/spec/${spec}.json"></flowfig-explain>`;

test('guide: moment 1 says the first beat, lifts the lane of its target, and Next moves to moment 2', { skip: !browser.path }, async () => {
  const page = await open(guide('oil'), `${live}.includes('The customer asks for a pickup in the app.')`);
  try {
    const acting = await page.ev(`[...${sr}.querySelectorAll('[data-actor][aria-current="true"]')].map((a) => a.dataset.actor)`);
    assert.deepEqual(acting, ['Office']);
    const first = await page.ev(`${el}.moment`);
    await page.ev(`${button('Next')}.click()`);
    await page.until(
      `${el}.moment === ${first + 1} && ${live}.includes('The office accepts it and looks for a free worker.')`,
      'Next moves to moment 2',
    );
  } finally {
    await page.done();
  }
});

test(
  'guide: a What if chip on a refusal step ends on ✗, the outcome and the moments it never reached',
  { skip: !browser.path },
  async () => {
    const page = await open(guide('oil'), `${live}.length > 0`);
    try {
      const step = 'Too many requests';
      await page.ev(`window.last = {}; ${el}.addEventListener('flowfig-moment', (e) => (window.last = e.detail))`);
      await page.ev(`${button(step)}.click()`);
      await page.until(`window.last.step === ${JSON.stringify(step)}`, 'the chip opens the refusal step');
      await page.ev(`(async () => {
      for (let i = 0; i < 12; i++) {
        const at = window.last.moment;
        ${button('Next')}.click();
        await ${sleep};
        if (window.last.step !== ${JSON.stringify(step)}) { ${button('Back')}.click(); await ${sleep}; break; }
        if (window.last.moment === at) break;
      }
    })()`);
      const text = await page.ev(`${sr}.textContent`);
      assert.equal(await page.ev('window.last.step'), step);
      for (const want of ['✗', 'Told: too many requests', 'not reached']) assert.ok(text.includes(want), want);
    } finally {
      await page.done();
    }
  },
);

test('diagram: the SVG inside the element equals the toSvg output for the same spec', { skip: !browser.path }, async () => {
  const page = await open(
    `<flowfig-explain form="diagram" src="/spec/sync.json"></flowfig-explain>`,
    `!!${sr}?.querySelector('svg[role="img"]')`,
  );
  try {
    const same = await page.ev(`(() => {
      const t = document.createElement('template');
      t.innerHTML = ${JSON.stringify(toSvg(sync.props))};
      return t.content.querySelector('svg').isEqualNode(${sr}.querySelector('svg[role="img"]'));
    })()`);
    assert.equal(same, true);
  } finally {
    await page.done();
  }
});

test(
  'change: the changed boxes and edges carry the diff marks, and one step chip plays on both sides',
  { skip: !browser.path },
  async () => {
    const page = await open(
      `<flowfig-explain form="change" src="/spec/delivery-after.json" before="/spec/delivery-before.json"></flowfig-explain>`,
      `${sr}?.querySelectorAll('svg[role="img"]').length === 2`,
    );
    try {
      const marks = diff(deliveryBefore.props, deliveryAfter.props).filter((c) => c.kind === 'box' || c.kind === 'edge');
      assert.ok(marks.length > 0);
      const missing = await page.ev(
        `${JSON.stringify(marks)}.filter((c) => !${sr}.querySelector('[data-diff="' + c.op + '"][data-id="' + CSS.escape(c.id) + '"]')).map((c) => c.op + ' ' + c.id)`,
      );
      assert.deepEqual(missing, []);
      await page.ev(`${button('Ledger write fails')}.click()`);
      const outcome = (side: string) => `(${sr}.querySelector('[data-side="${side}"] [data-outcome]')?.textContent ?? '')`;
      await page.until(
        `${outcome('before')}.includes('Ledger miss logged') && ${outcome('after')}.includes('Job kept for a rerun')`,
        'both sides play the step to its outcome',
        30_000,
      );
    } finally {
      await page.done();
    }
  },
);

test('host CSS does not reach the text inside the element', { skip: !browser.path }, async () => {
  const page = await open(
    `<style>* { color: red !important; font-size: 30px !important }</style>${guide('oil')}`,
    `${live}.includes('The customer asks for a pickup in the app.')`,
  );
  try {
    const found = await page.ev(`(() => {
      const texts = [...${sr}.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const hit = texts.filter((e) => { const s = getComputedStyle(e); return s.color === 'rgb(255, 0, 0)' || s.fontSize === '30px'; });
      return { count: texts.length, hit: hit.map((e) => e.tagName + ': ' + e.textContent.trim().slice(0, 40)) };
    })()`);
    assert.ok(found.count > 0, 'the element shows text');
    assert.deepEqual(found.hit, []);
  } finally {
    await page.done();
  }
});

test('arrow keys move the moment, and the live region reads the new sentence', { skip: !browser.path }, async () => {
  const page = await open(guide('oil'), `${live}.includes('The customer asks for a pickup in the app.')`);
  const key = async (key: string, code: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
  };
  try {
    const first = await page.ev(`${el}.moment`);
    await page.ev(`${el}.focus()`);
    await key('ArrowRight', 39);
    await page.until(
      `${el}.moment === ${first + 1} && ${live}.includes('The office accepts it and looks for a free worker.')`,
      'ArrowRight moves to the next moment',
    );
    await key('ArrowLeft', 37);
    await page.until(`${el}.moment === ${first}`, 'ArrowLeft moves back');
    assert.match(await page.ev(live), /The customer asks for a pickup in the app\./);
  } finally {
    await page.done();
  }
});

test('the flowfig/element bundle is at most 45 kB gzip', () => {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, , spec] of readFileSync(file, 'utf8').matchAll(/(from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g))
      walk(join(dirname(file), spec));
  };
  walk(join(dist, 'element.js'));
  const bytes = [...seen].reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
  assert.ok(bytes <= 45_000, `${bytes} bytes gzip in ${seen.size} files`);
});
