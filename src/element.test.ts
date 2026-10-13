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
import returns from '../figures/returns-process.ts';
import checkout from '../figures/checkout.ts';
import { scene, stateAt, place, stageFor } from './world.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const specs: Record<string, object> = {
  oil: oil.props,
  sync: sync.props,
  'delivery-before': deliveryBefore.props,
  'delivery-after': deliveryAfter.props,
  returns: returns.props,
  checkout: checkout.props,
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
  const page = await open(
    guide('oil'),
    `${live}.includes('The customer asks for a pickup in the app.') && !!${sr}?.querySelector('[data-actor]')`,
  );
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

test('guide: a story chip on a refusal story ends on ✗, the outcome and the boxes it skipped', { skip: !browser.path }, async () => {
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
    for (const want of ['✗', 'Told: too many requests', 'Skipped, because of the refusal']) assert.ok(text.includes(want), want);
  } finally {
    await page.done();
  }
});

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
        `${outcome('before')}.includes('Ledger miss logged') && ${outcome('after')}.includes('All records agree')`,
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

test('the element core and the world chunk stay in budget', () => {
  const deps = (file: string) =>
    [...readFileSync(file, 'utf8').matchAll(/\b(?:from|import)\s*(\()?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(([, call, spec]) => ({
      file: join(dirname(file), spec),
      lazy: !!call,
    }));
  const reach = (start: string, lazy: boolean, seen = new Set<string>()) => {
    if (seen.has(start)) return seen;
    seen.add(start);
    for (const d of deps(start)) if (lazy || !d.lazy) reach(d.file, lazy, seen);
    return seen;
  };
  const gz = (files: Iterable<string>) => [...files].reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
  const entry = join(dist, 'element.js');
  assert.ok(
    deps(entry).some((d) => d.lazy && d.file.endsWith('element-world.js')),
    'element.js loads the world on demand',
  );
  const core = reach(entry, false);
  const world = [...reach(join(dist, 'element-world.js'), true)].filter((f) => !core.has(f));
  assert.ok(gz(core) <= 45_000, `core: ${gz(core)} B gzip in ${core.size} files`);
  assert.ok(gz(world) <= 24_000, `world chunk: ${gz(world)} B gzip in ${world.length} files`);
});

test('a qualifying figure loads the world, and other figures do not', { skip: !browser.path }, async () => {
  const loaded = `performance.getEntriesByType('resource').some((r) => r.name.endsWith('/dist/element-world.js'))`;
  const world = await open(guide('oil'), `!!${sr}?.querySelector('[data-stage="world"] svg[role="img"]')`);
  try {
    assert.equal(await world.ev(loaded), true);
  } finally {
    await world.done();
  }
  const plain = await open(guide('checkout'), `!!${sr}?.querySelector('[data-stage="diagram"] svg[role="img"]')`);
  try {
    await plain.ev(sleep);
    assert.equal(await plain.ev(loaded), false);
  } finally {
    await plain.done();
  }
});

test('the drawn overlays sit where the layout put them', { skip: !browser.path }, async () => {
  const page = await open(guide('oil'), `${live}.length > 0`);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.ev(`${button('Expired certification')}.click()`);
    await page.ev(`${el}.moment = ${el}.moment + 2`);
    await page.until(
      `(${sr}.querySelector('[data-actor="Worker"]')?.textContent ?? '').includes('Record refused')`,
      'the refusal frame shows',
    );
    type Drawn = { actor: string; x: number; y: number; w: number; h: number; fits: boolean };
    const got: { w: number; h: number; tags: Drawn[] } = await page.ev(`(() => {
      const g = ${sr}.querySelector('.ff-guide').getBoundingClientRect();
      return { w: g.width, h: g.height, tags: [...${sr}.querySelectorAll('[data-actor]')].map((t) => {
        const r = t.getBoundingClientRect();
        return { actor: t.dataset.actor, x: r.x - g.x, y: r.y - g.y, w: r.width, h: r.height, fits: t.scrollWidth <= t.clientWidth && t.scrollHeight <= t.clientHeight };
      }) };
    })()`);
    const sc = scene(oil.props);
    const s = sc.stories.findIndex((x) => x.name === 'Expired certification');
    const want = place(sc, stateAt(sc, s, 2, Infinity), stageFor(got.w, got.h));
    assert.equal(got.tags.length, want.tags.length);
    for (const t of want.tags) {
      const drawn = got.tags.find((x) => x.actor === t.name);
      assert.ok(drawn, t.name);
      for (const k of ['x', 'y', 'w', 'h'] as const)
        assert.ok(Math.abs(drawn[k] - t.r[k]) <= 2, `${t.name} ${k}: ${drawn[k]} vs ${t.r[k]}`);
      assert.ok(drawn.fits, `${t.name}: the text is wider than its tag`);
    }
  } finally {
    await page.done();
  }
});
