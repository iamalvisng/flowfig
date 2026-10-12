import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browser, withReactPage, type Page } from './react-page.ts';
import { isGroup, tourPlan, type FigGroup, type FigNode, type FlowProps } from './model.ts';
import { render, toSvg } from './svg.ts';
import { decodePng } from './png.ts';
import shop from '../figures/inside-shop.ts';

const shopFig = shop.props as FlowProps;
const skip = !browser.path;
const cli = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'figure-svg.mjs');

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Flow } from '/dist/index.js';
import shop from '/figures/inside-shop.ts';
window.plain = () => createRoot(document.body.appendChild(document.createElement('div'))).render(createElement(Flow, { layout: { children: [{ id: 'solo', label: 'Solo' }] }, edges: [] }));
window.show = (o) => createRoot(document.getElementById('root')).render(createElement(Flow, { ...shop.props, ...o }));
`;

const SHOWN = `((e) => {
  if (!e) return 0;
  let o = 1;
  for (; e && e.nodeType === 1; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') return 0;
    o *= +s.opacity;
  }
  return o;
})`;
const box = (id: string) => `document.querySelector('[data-fig="${id}"]')`;
const shown = (el: string) => `${SHOWN}(${el}) > 0.69`;
const allShown = (ids: string[]) => ids.map((id) => shown(box(id))).join(' && ');
const BACK = `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent).trim().startsWith('Back'))`;
const ORDERS = ['gateway', 'validate', 'reserve', 'total', 'save', 'publish', 'payments'];
const ROOT = `(!!${box('cart')} && !${box('validate')})`;
const FOCUS_ORDERS = `document.activeElement?.getAttribute('aria-label') === 'Open Orders, 5 parts'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const press = async (send: Page['send'], key: 'Tab' | 'Enter' | 'Escape' | 'Backspace') => {
  const code = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8 }[key];
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
};
const clickAt = async ({ send, ev }: Page, el: string) => {
  const [x, y] = await ev(`(() => { const r = ${el}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const show = async ({ ev, until, load }: Page, width: number, options: object) => {
  await load(width);
  await until('!!window.show', 'the page loads');
  await ev(`show(${JSON.stringify(options)})`);
  await until(`!!${box('orders')}`, 'the root level renders');
};
const openOrders = async ({ ev, until }: Page) => {
  await ev(`${box('orders')}.click()`);
  await until(allShown(ORDERS), 'the Orders level shows');
};

const RECORD = `(() => {
  const ids = new WeakMap();
  let next = 0;
  const key = (e) => (ids.has(e) || ids.set(e, next++), ids.get(e));
  const fig = document.querySelector('figure');
  window.rec = { frames: [], stop: false };
  const tick = (t) => {
    const rects = {};
    for (const e of fig.querySelectorAll('*')) {
      const r = e.getBoundingClientRect();
      if (r.width || r.height) rects[key(e)] = [r.x, r.y, r.width, r.height].map(Math.round).join();
    }
    const boxes = {};
    for (const b of fig.querySelectorAll('[data-fig]')) boxes[b.dataset.fig] = Math.max(boxes[b.dataset.fig] ?? 0, ${SHOWN}(b));
    const running = document.getAnimations().filter((a) => a.playState === 'running').length;
    rec.frames.push({ t, rects, boxes, running });
    if (!rec.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const summary = (ids: string[]) => `(() => {
  rec.stop = true;
  const moves = {};
  rec.frames.forEach((f, i) => {
    if (!i) return;
    for (const [k, r] of Object.entries(f.rects)) if (rec.frames[i - 1].rects[k] && rec.frames[i - 1].rects[k] !== r) moves[k] = (moves[k] ?? 0) + 1;
  });
  const appear = {};
  const hidden = new Set();
  for (const f of rec.frames.slice(1))
    for (const id of ${JSON.stringify(ids)}) {
      const o = f.boxes[id] ?? 0;
      if (o < 0.01) hidden.add(id);
      else if (hidden.has(id) && appear[id] == null) appear[id] = f.t;
    }
  return {
    movers: Object.values(moves).filter((n) => n >= 3).length,
    appear,
    partial: rec.frames.some((f) => Object.values(f.boxes).some((o) => o > 0.01 && o < 0.69)),
    running: Math.max(...rec.frames.map((f) => f.running)),
  };
})()`;

test(
  'a click on "Orders" shows its parts, the path line "Orders" and the in and out ports, and "Check the cart" adds to the path',
  { skip },
  async () => {
    await withReactPage(entry, async (page) => {
      await show(page, 1400, { autoplay: false });
      await openOrders(page);
      assert.equal(await page.ev(`!!${box('cart')}`), false, 'the root boxes are gone');
      assert.equal(await page.ev(`${box('gateway')}.innerText.trim()`), 'in: from Gateway');
      assert.equal(await page.ev(`${box('payments')}.innerText.trim()`), 'out: to Payments');
      assert.ok(await page.ev(`!!${BACK}`), 'the header has a Back button');
      await page.ev(`${box('validate')}.click()`);
      await page.until(allShown(['parse-cart', 'check-limits']), 'the Check the cart level shows');
      assert.match(await page.ev(`document.querySelector('figure').innerText`), /Orders\s*>\s*Check the cart/);
    });
  },
);

test('a figure with parts dims the boxes outside the active step, as any figure does', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await show(page, 1400, { autoplay: false });
    await page.until(`getComputedStyle(${box('browser')}).opacity < 0.99`, 'the boxes outside the step dim');
    assert.ok(await page.ev(`+getComputedStyle(${box('browser')}).opacity > 0.69`), 'the dim keeps the box readable');
  });
});

test('the back button and Escape return to the root level, and focus lands on "Orders"', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await show(page, 1400, { autoplay: false });
    await openOrders(page);
    await page.ev(`${BACK}.click()`);
    await page.until(ROOT, 'Back shows the root level');
    await page.until(FOCUS_ORDERS, 'focus returns to Orders after Back');
    await openOrders(page);
    await press(page.send, 'Escape');
    await page.until(ROOT, 'Escape shows the root level');
    await page.until(FOCUS_ORDERS, 'focus returns to Orders after Escape');
    assert.equal(await page.ev(`document.querySelectorAll('[data-fig="validate"]').length`), 0, 'no part of the closed level stays');
  });
});

test('keyboard only: Tab reaches "Orders", Enter opens it, the live region reads the level, Backspace goes back', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await show(page, 1400, { autoplay: false });
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await press(page.send, 'Tab');
      reached = await page.ev(FOCUS_ORDERS);
    }
    assert.ok(reached, 'Tab reaches Orders');
    assert.equal(await page.ev(`!!document.activeElement.closest('[role="img"]')`), false, 'no role="img" hides the box button');
    await press(page.send, 'Enter');
    await page.until(allShown(ORDERS), 'Enter opens Orders');
    await page.until(
      `[...document.querySelectorAll('[aria-live="polite"]')].some((e) => e.textContent.includes('Orders: 5 parts. In from Gateway. Out to Payments.'))`,
      'the live region reads the level',
    );
    await press(page.send, 'Backspace');
    await page.until(ROOT, 'Backspace shows the root level');
  });
});

test(
  'a box opened during play starts the packet at the in-port, and after back the outer step goes on at the next beat',
  { skip },
  async () => {
    const steps = shopFig.steps!.map((s) => ({ ...s, flow: s.flow.map((b) => ({ ...(b as object), ms: 1500 })) }));
    await withReactPage(entry, async (page) => {
      await show(page, 1400, { speed: 400, steps });
      await page.ev(`document.querySelectorAll('[role="tab"]')[0].click()`);
      await page.until(`${box('orders')}?.classList.contains('flowfig-active')`, 'the packet arrives at Orders');
      await openOrders(page);
      const dot = `(() => {
      const g = [...document.querySelectorAll('circle[r="4.5"]')].map((c) => c.parentElement).find((g) => +getComputedStyle(g).opacity > 0);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`;
      await page.until(`!!${dot}`, 'the packet shows in the Orders level');
      const [x, y] = await page.ev(dot);
      const far = async (id: string) => {
        const [cx, cy] = await page.ev(
          `(() => { const r = ${box(id)}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
        );
        return Math.hypot(cx - x, cy - y);
      };
      assert.ok((await far('gateway')) < (await far('validate')), 'the packet starts at the in-port');
      await page.ev(`${BACK}.click()`);
      await page.until(ROOT, 'Back shows the root level');
      assert.ok(
        !(await page.ev(`document.querySelector('figcaption').innerText`)).includes('The gateway asks Orders to place the order.'),
        'the step does not restart',
      );
      await page.until(
        `document.querySelector('figcaption').innerText.includes('Orders asks Payments to charge the card.')`,
        'the outer step goes on at the beat after the arrival',
      );
    });
  },
);

test('during the open only the border moves, and the ports then the parts appear in flow order 40 to 60 ms apart', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await show(page, 1400, { autoplay: false });
    await page.ev(RECORD);
    await openOrders(page);
    await sleep(300);
    const { movers, appear } = await page.ev(summary(ORDERS));
    assert.equal(movers, 1, 'one element moves: the border');
    const order = [...ORDERS].sort((a, b) => appear[a] - appear[b]);
    assert.deepEqual(order, ['gateway', 'payments', 'validate', 'reserve', 'total', 'save', 'publish']);
    const gap = (appear.publish - appear.gateway) / (order.length - 1);
    assert.ok(gap >= 40 && gap <= 60, `the parts appear ${gap} ms apart`);
  });
});

test('with reduced motion, open and back change the view in one frame and no animation runs', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await show(page, 1400, { autoplay: false });
    await page.ev('plain()');
    await page.until(`!!${box('solo')}`, 'the plain figure renders');
    assert.notEqual(
      await page.ev(`getComputedStyle(${box('solo')}).transitionDuration`),
      '0s',
      'a figure with no parts keeps its transitions',
    );
    for (const [what, go, done] of [
      ['open', () => page.ev(`${box('orders')}.click()`), allShown(ORDERS)],
      ['back', () => press(page.send, 'Escape'), ROOT],
    ] as const) {
      await page.ev(RECORD);
      await go();
      await page.until(done, `${what} shows the level`);
      await sleep(300);
      const { movers, partial, running } = await page.ev(summary(ORDERS));
      assert.deepEqual({ movers, partial, running }, { movers: 0, partial: false, running: 0 }, what);
    }
  });
});

test('at 375 px a wide level folds to a column and reader text stays at 11 px or more', { skip }, async () => {
  await withReactPage(entry, async (page) => {
    await show(page, 375, { autoplay: false, check: true });
    await openOrders(page);
    await sleep(600);
    const [a, b] = await page.ev(
      `['validate', 'reserve'].map((id) => { const r = document.querySelector('[data-fig="' + id + '"]').getBoundingClientRect(); return [r.y, r.height]; })`,
    );
    assert.ok(b[0] >= a[0] + a[1], 'the parts stack in a column');
    const least = await page.ev(`(() => {
      let least = Infinity;
      for (const b of document.querySelectorAll('[data-fig]'))
        for (const e of [b, ...b.querySelectorAll('*')])
          if (e.offsetWidth && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            least = Math.min(least, parseFloat(getComputedStyle(e).fontSize) * (e.getBoundingClientRect().width / e.offsetWidth));
      return least;
    })()`);
    assert.ok(least >= 11 - 0.01, `the smallest reader text is ${least} px`);
  });
});

test('as an <img>, the README form shows the Orders level at its tour time, and the pixels match the inline still', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inside-'));
  try {
    const svg = toSvg(shopFig);
    writeFileSync(join(dir, 'shop.svg'), svg);
    writeFileSync(join(dir, 'img.html'), '<body style="margin:0"><img src="shop.svg"></body>');
    writeFileSync(join(dir, 'still.html'), `<body style="margin:0">${svg}</body>`);
    const at = tourPlan(shopFig).opens.find((o) => o.path.join() === 'orders')!.open[1] - 1000;
    await withReactPage('', async ({ send, ev, open }) => {
      const shot = async (el: string) => {
        const clip = await ev(
          `(() => { const r = ${el}.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`,
        );
        return decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64'));
      };
      await open(pathToFileURL(join(dir, 'still.html')).href, 1600);
      await send('Runtime.evaluate', {
        expression: `(() => {
          const svg = document.querySelector('svg');
          svg.pauseAnimations();
          for (const a of document.getAnimations()) (a.pause(), (a.currentTime = ${at}));
          svg.setCurrentTime(${at / 1000});
          return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        })()`,
        awaitPromise: true,
      });
      assert.ok(await ev(shown(`document.getElementById('s-orders')`)), 'the still shows the Orders level');
      const still = await shot(`document.querySelector('svg')`);
      await open(pathToFileURL(join(dir, 'img.html')).href, 1600);
      const loaded = Date.now();
      await sleep(at - (Date.now() - loaded));
      const img = await shot(`document.querySelector('img')`);
      assert.deepEqual([img.width, img.height], [still.width, still.height]);
      let differ = 0;
      for (let i = 0; i < img.data.length; i += 4)
        if (Math.max(...[0, 1, 2].map((k) => Math.abs(img.data[i + k] - still.data[i + k]))) > 32) differ++;
      // Measured: text antialias alone makes 0.6 % of pixels differ between an img and inline.
      assert.ok(differ / (img.width * img.height) < 0.02, `${differ} pixels differ`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a standalone SVG made with --script: a click opens "Orders", the tour stops, Escape goes back', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inside-'));
  try {
    const out = join(dir, 'shop.svg');
    const r = spawnSync('node', [cli, 'inside-shop', out, '--script'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    await withReactPage('', async (page) => {
      await page.open(pathToFileURL(out).href, 1600);
      const orders = `document.querySelector('[role="button"][aria-label^="Open Orders"]')`;
      await page.until(shown(orders), 'the root level shows');
      await clickAt(page, orders);
      await page.until(shown(`document.getElementById('s-orders')`), 'the click opens Orders');
      for (let t = 0; t < 2000; t += 200, await sleep(200)) {
        assert.ok(await page.ev(shown(`document.getElementById('s-orders')`)), 'Orders stays open');
        assert.ok(!(await page.ev(shown(`document.getElementById('s-gateway')`))), 'the tour does not go on to Gateway');
      }
      await press(page.send, 'Escape');
      await page.until(`${shown(orders)} && !(${shown(`document.getElementById('s-orders')`)})`, 'Escape shows the root level');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with reduced motion, a standalone SVG shows the hold frame of the loop at the root', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inside-'));
  try {
    writeFileSync(join(dir, 'still.html'), `<body style="margin:0">${toSvg(shopFig, { script: true })}</body>`);
    await withReactPage('', async (page) => {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.open(pathToFileURL(join(dir, 'still.html')).href, 1600);
      await sleep(300);
      const hold = await page.ev(`+document.querySelector('.scene').dataset.loop.split(' ')[0].split(',')[1] * 1e3`);
      const times = await page.ev(
        `[...new Set(document.getAnimations().map((a) => Math.round(a.currentTime - a.effect.getTiming().delay)))]`,
      );
      assert.deepEqual(times, [Math.round(hold)]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two different figures with parts on one page: a click opens a box in the first figure only', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inside-'));
  try {
    const slower = { ...shopFig, steps: shopFig.steps!.slice(0, 1) };
    const svg = toSvg(shopFig, { script: true }),
      other = toSvg(slower, { script: true });
    const names = (x: string) => new Set([...x.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]));
    assert.deepEqual(
      [...names(svg)].filter((n) => names(other).has(n)),
      [],
      'the two figures share no animation name',
    );
    writeFileSync(join(dir, 'two.html'), `<body style="margin:0">${svg}${other}</body>`);
    await withReactPage('', async (page) => {
      await page.open(pathToFileURL(join(dir, 'two.html')).href, 1600);
      const fig = (i: number, sel: string) => `document.querySelectorAll('body > svg')[${i}].querySelector('${sel}')`;
      const orders = (i: number) => fig(i, '[role="button"][aria-label^="Open Orders"]');
      await page.until(`${shown(orders(0))} && ${shown(orders(1))}`, 'both figures show the root level');
      await clickAt(page, orders(0));
      await page.until(shown(fig(0, '#s-orders')), 'the first figure opens Orders');
      await sleep(500);
      assert.ok(await page.ev(shown(orders(1))), 'the second figure keeps the root level');
      assert.ok(!(await page.ev(shown(fig(1, '#s-orders')))), 'the second figure does not open Orders');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the player and the SVG place each box of each level within 1 px', { skip }, async () => {
  const owners = (g: FigGroup): FigNode[] => g.children.flatMap((c) => (isGroup(c) ? owners(c) : c.inside ? [c] : []));
  const relative = (rects: Record<string, number[]>) => {
    const x = Math.min(...Object.values(rects).map((r) => r[0])),
      y = Math.min(...Object.values(rects).map((r) => r[1]));
    return Object.fromEntries(Object.entries(rects).map(([id, [rx, ry, w, h]]) => [id, [rx - x, ry - y, w, h]]));
  };
  await withReactPage(entry, async (page) => {
    await show(page, 1600, { autoplay: false });
    const compare = async (owner: FigNode) => {
      const want = relative(
        Object.fromEntries(render(shopFig, { scene: owner.id }).scene.boxes.map((b) => [b.id, [b.rect.x, b.rect.y, b.rect.w, b.rect.h]])),
      );
      await page.until(allShown(Object.keys(want)), `the ${owner.id} level shows`);
      await sleep(600);
      const got = relative(
        await page.ev(`Object.fromEntries(${JSON.stringify(Object.keys(want))}.map((id) => {
          const r = document.querySelector('[data-fig="' + id + '"]').getBoundingClientRect();
          return [id, [r.x, r.y, r.width, r.height]];
        }))`),
      );
      for (const [id, r] of Object.entries(want))
        assert.ok(
          r.every((v, i) => Math.abs(v - got[id][i]) <= 1),
          `${owner.id} > ${id}: SVG ${r.join()}, player ${got[id].join()}`,
        );
    };
    const back = (to: string) => page.ev(`${BACK}.click()`).then(() => page.until(shown(box(to)), `back shows ${to}`));
    for (const owner of owners(shopFig.layout)) {
      await page.ev(`${box(owner.id)}.click()`);
      await compare(owner);
      for (const inner of owners(owner.inside!.layout)) {
        await page.ev(`${box(inner.id)}.click()`);
        await compare(inner);
        await back(inner.id);
      }
      await back(owner.id);
    }
  });
});
