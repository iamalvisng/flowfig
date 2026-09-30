import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSvg, render, check } from './svg.ts';
import { DARK, BASE_RATE, STEP_HOLD_MS, beatMs, type FlowProps } from './model.ts';
import { layoutRail, railState, RAIL } from './rail.ts';

const fig: FlowProps = {
  speed: 1000,
  layout: {
    id: 'app',
    label: 'App',
    children: [
      { id: 'checkout', label: 'Checkout', sub: 'calls in' },
      { id: 'store', label: 'Orders', shape: 'store' },
    ],
  },
  edges: [{ id: 'call', from: 'checkout', to: 'store', label: 'placeOrder()' }],
  steps: [
    {
      label: 'placeOrder()',
      flow: [
        { edges: { edge: 'call', data: 'the cart' }, say: 'The checkout sends the cart.' },
        { show: { store: [{ tag: 'order', tone: 'blue', text: '#981 · 3 items', meta: 'Mar', mark: 'new' }] } },
        { edges: { edge: 'call', back: true }, say: 'It comes back stored.' },
      ],
    },
  ],
};

test('draws every label, the edge and its packets', () => {
  const svg = toSvg(fig);
  for (const label of ['Checkout', 'calls in', 'Orders', 'APP', 'placeOrder()']) assert.ok(svg.includes(label), label);
  // one packet per hop, both riding the same routed path
  assert.equal(svg.match(/<animateMotion/g)?.length, 2);
  assert.equal(svg.match(/<mpath /g)?.length, 2);
  // the returning packet runs the path backwards
  assert.ok(svg.includes('keyPoints="1;1;0;0"'));
});

test('shows the card content and the narration', () => {
  const svg = toSvg(fig);
  assert.ok(svg.includes('#981 · 3 items'), 'card text');
  assert.ok(svg.includes('ORDER'), 'tag pill');
  assert.ok(svg.includes('#3b82f6'), 'blue tone');
  assert.ok(svg.includes('new'), 'mark');
  assert.ok(svg.includes('The checkout sends the cart.'), 'first caption');
  assert.ok(svg.includes('It comes back stored.'), 'later caption');
});

test('is a standalone, themeable, script-free image', () => {
  const svg = toSvg(fig);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!svg.includes('<script'), 'no scripts: GitHub would strip them');
  assert.ok(svg.includes('@media (prefers-color-scheme: dark)'), 'dark mode');
  assert.ok(!svg.includes('@font-face') && !svg.includes('http://fonts'), 'no font to fetch');
  // every class is a single attribute — two would make it invalid XML
  for (const tag of svg.match(/<[a-z]+[^>]*>/g) ?? [])
    assert.ok((tag.match(/ class="/g)?.length ?? 0) <= 1, `two class attributes: ${tag.slice(0, 80)}`);
});

test('a figure with no steps still draws its boxes', () => {
  const svg = toSvg({ layout: fig.layout, edges: fig.edges });
  assert.ok(svg.includes('Checkout') && svg.includes('Orders'));
  assert.ok(!svg.includes('<animateMotion'), 'nothing to animate');
});

test('an edge label pill is wide enough for its monospace text', () => {
  const label = 'a-long-monospace-label';
  const svg = toSvg({ layout: fig.layout, edges: [{ ...fig.edges[0], label }] });
  const w = Number(svg.match(/<rect [^>]*width="([\d.]+)" height="18" rx="9"/)![1]);
  assert.ok(w >= label.length * 11 * 0.6 + 14 - 0.1, `pill ${w} px`);
});

test('dark mode uses the shared dark colors', () => {
  const dark = toSvg(fig).match(/@media \(prefers-color-scheme: dark\) \{ svg \{ ([^}]*)\}/)![1];
  assert.ok(dark.includes(`--accent:${DARK.accent}`), dark);
  assert.ok(dark.includes(`--bg:${DARK.bg}`), dark);
});

test('the scene matches what the SVG drew', () => {
  const { svg, scene } = render(fig);
  assert.deepEqual(
    scene.boxes.map((b) => b.id),
    ['checkout', 'store'],
  );
  assert.deepEqual(
    scene.edges.map((e) => e.id),
    ['call'],
  );
  assert.ok(scene.edges[0].label, 'the edge label rectangle');
  assert.equal(`width="${scene.width}"`, svg.match(/width="[\d.]+"/)![0]);
  assert.ok(scene.minFont >= 10.5, 'tags do not count as reading text');
});

test('the example figure has no errors', () => {
  assert.deepEqual(
    check(fig).filter((f) => f.severity === 'error'),
    [],
  );
});

test('a CJK label in a fixed-width box overflows', () => {
  const cjk: FlowProps = { layout: { children: [{ id: 'a', label: '日本語のとても長いラベル', width: 100 }] }, edges: [] };
  assert.deepEqual(
    check(cjk).map((f) => f.rule),
    ['text-overflow'],
  );
});

test('a quiet edge is in the scene, because the SVG draws it during its beat', () => {
  const quiet: FlowProps = { ...fig, edges: [{ ...fig.edges[0], quiet: true }] };
  assert.equal(render(quiet).scene.edges.length, 1);
});

const railFig: FlowProps = {
  ...fig,
  rail: true,
  steps: [
    {
      label: 'placeOrder()',
      flow: [{ edges: { edge: 'call', data: 'the cart' } }, { edges: { edge: 'call', back: true, async: true } }],
    },
  ],
};

test('rail: true draws the rail between the map and the caption, and adds its pills to the scene', () => {
  const { svg, scene } = render(railFig);
  assert.equal(svg.match(/class="railrow/g)?.length, 2);
  assert.ok(svg.includes('ASYNC'), 'async tag');
  assert.ok(
    scene.edges.some((e) => e.id === 'rail:1' && e.label),
    'rail pill in the scene',
  );
  const plain = render({ ...railFig, rail: false });
  assert.ok(Number(svg.match(/height="([\d.]+)"/)![1]) > Number(plain.svg.match(/height="([\d.]+)"/)![1]));
});

test('rail: true with no steps draws the plain map', () => {
  assert.equal(render({ ...railFig, steps: [] }).svg, render({ ...railFig, rail: false, steps: [] }).svg);
});

test('the rail adds no new color and no new font size', () => {
  const style = (s: string) =>
    s.slice(s.indexOf('<style>'), s.indexOf('@keyframes') === -1 ? s.indexOf('</style>') : s.indexOf('@keyframes'));
  const colors = (s: string) => new Set(style(s).match(/#[0-9a-f]{3,6}\b/gi));
  const sizes = (s: string) => new Set(style(s).match(/font-size: [\d.]+px/g));
  const withRail = render(railFig).svg,
    without = render({ ...railFig, rail: false }).svg;
  assert.deepEqual(colors(withRail), colors(without));
  assert.deepEqual(sizes(withRail), sizes(without));
});

test('the rail passes flowfig check', () => {
  assert.deepEqual(
    check(railFig).filter((f) => f.severity === 'error'),
    [],
  );
});

test('the ASYNC tag sits on its own row line, below the pill of the row above', () => {
  const { svg } = render(railFig);
  const attr = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([\\d.-]+)"`))![1]);
  const tagRect = svg.match(/<rect [^>]*\/>(?=<text[^>]*>ASYNC<)/)![0];
  const pill = svg.slice(svg.indexOf('class="railrow')).match(/<rect [^>]*rx="9"[^>]*\/>/)![0];
  assert.ok(attr(tagRect, 'y') >= attr(pill, 'y') + attr(pill, 'height'), 'tag top below the first pill bottom');
});

test('the ASYNC tag sits on the tail side of the pill, so it never hides the arrowhead', () => {
  const { svg } = render(railFig);
  const attr = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([\\d.-]+)"`))![1]);
  const tagRect = svg.match(/<rect [^>]*\/>(?=<text[^>]*>ASYNC<)/)![0];
  const rows = svg.slice(svg.indexOf('class="railrow'));
  const pill = [...rows.matchAll(/<rect [^>]*rx="9"[^>]*\/>/g)][1][0];
  assert.ok(attr(tagRect, 'x') > attr(pill, 'x') + attr(pill, 'width'), 'left-pointing arrow: tag right of the pill');
});

test('a rail pill in the scene is the drawn pill, in the map coordinates', () => {
  const { svg, scene } = render(railFig);
  const num = (s: string, a: string) => Number(s.match(new RegExp(` ${a}="([\\d.-]+)"`))![1]);
  const [mapX, mapY] = svg
    .match(/<g transform="translate\(([\d.-]+) ([\d.-]+)\)">\n/)!
    .slice(1)
    .map(Number);
  const railX = Number(svg.match(/<g transform="translate\(([\d.-]+) 0\)"><rect/)![1]);
  const drawn = svg.slice(svg.indexOf('class="railrow')).match(/<rect [^>]*rx="9"[^>]*\/>/)![0];
  const label = scene.edges.find((e) => e.id === 'rail:1')!.label!;
  // The SVG writes one decimal.
  assert.ok(Math.abs(label.x + mapX - (num(drawn, 'x') + railX)) <= 0.05, 'x');
  assert.ok(Math.abs(label.y + mapY - num(drawn, 'y')) <= 0.05, 'y');
  assert.ok(Math.abs(label.w - num(drawn, 'width')) <= 0.05, 'width');
  assert.equal(label.h, num(drawn, 'height'));
});

test('a folded rail: each counter sits on its phase row and moves with it; the height fits every segment', () => {
  const many: FlowProps = {
    ...railFig,
    steps: [
      { label: 'one', flow: Array(6).fill('call') },
      { label: 'two', flow: [...Array(5).fill('call'), [{ edge: 'call' }, { edge: 'call', back: true }]] },
    ],
  };
  const svg = toSvg(many);
  // A phase row: the move group (the first phase never moves), the open label, the folded label, then one counter per beat.
  const phases = [
    ...svg.matchAll(
      /<g(?: class="(a\d+)")?><g[^>]*><text [^>]*y="([\d.]+)" class="railphase">(\w+)<\/text>.*?<\/g><g[^>]*><text [^>]*class="railphase muted">.*?<\/g>((?:<text [^>]*>\d+ of 13<\/text>)+)<\/g>/g,
    ),
  ];
  assert.deepEqual(
    phases.map((p) => p[3]),
    ['one', 'two'],
  );
  assert.ok(phases[1][1] && svg.includes(`.${phases[1][1]} { animation`), 'the second phase row moves when the first phase folds');
  for (const [, , y, , counters] of phases) {
    const ys = [...counters.matchAll(/ y="([\d.]+)"/g)].map((m) => m[1]);
    assert.ok(
      ys.every((cy) => Number(cy) === Number(y)),
      'counter on the phase row',
    );
  }
  // 6 beats in each step, so 6 counters each; the parallel beat has one counter.
  assert.deepEqual(
    phases.map((p) => p[4].match(/ of 13/g)!.length),
    [6, 6],
  );
  const rail = layoutRail(many, 560)!;
  assert.equal(rail.folds, true);
  for (let s = 0; s < 2; s++) {
    const st = railState(rail, s);
    const bottom = Math.max(...st.map((x, i) => (x.shown ? x.y + (rail.rows[i].kind === 'phase' ? RAIL.phase : RAIL.row) : 0)));
    assert.ok(bottom <= rail.height, `segment ${s} fits the rail height`);
  }
});

test('a folded phase label has the muted class, and the style gives that class the muted color', () => {
  const many: FlowProps = {
    rail: true,
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'call', from: 'a', to: 'b' }],
    steps: [
      { label: 'one', flow: Array(6).fill('call') },
      { label: 'two', flow: Array(6).fill('call') },
    ],
  };
  const svg = toSvg(many);
  assert.match(svg, /<text [^>]*class="railphase muted">/);
  const css = svg.match(/<style>([\s\S]*?)<\/style>/)![1];
  // The last rule that sets a fill for both classes wins, so it must be the muted one.
  const rules = [...css.matchAll(/^([^{\n]+)\{\s*fill:\s*([^;]+);/gm)].filter(([, sel]) =>
    /(^|,\s*)\.railphase\.muted\b|(^|,\s*)\.muted\b|(^|,\s*)\.railphase\b/.test(sel),
  );
  const win = rules.filter(([, sel]) => /\.railphase\.muted/.test(sel)).at(-1) ?? rules.at(-1)!;
  assert.equal(win[2].trim(), 'var(--muted)');
  assert.ok(css.indexOf('.railphase.muted') > css.indexOf('.railphase {'), 'the combined rule comes after the base rule');
});

test("rail: 'only' draws the rail without the map", () => {
  const only = render({ ...railFig, rail: 'only' });
  const both = render(railFig);
  assert.equal(only.svg.match(/class="railrow/g)?.length, 2);
  assert.doesNotMatch(only.svg, /class="label"/);
  assert.doesNotMatch(only.svg, /<animateMotion/);
  assert.equal(only.scene.boxes.length, 0);
  assert.ok(only.scene.edges.length > 0 && only.scene.edges.every((e) => e.id.startsWith('rail:')));
  const h = (s: string) => Number(s.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
  assert.ok(h(only.svg) < h(both.svg), 'shorter than the rail with the map');
  assert.ok(only.scene.width >= 560);
});

test("rail: 'only' with no steps draws the plain map", () => {
  assert.equal(render({ ...railFig, rail: 'only', steps: [] }).svg, render({ ...railFig, rail: false, steps: [] }).svg);
});

test('the SVG applies fig.theme, the theme font, and lets opts.theme win', () => {
  const themed: FlowProps = { ...fig, theme: { accent: '#ff0000', font: 'Georgia' } };
  const svg = toSvg(themed);
  assert.ok(svg.includes('#ff0000'));
  assert.ok(svg.includes('font-family="Georgia"'));
  assert.ok(toSvg(themed, { theme: { accent: '#00ff00' } }).includes('#00ff00'));
  assert.ok(!toSvg(themed, { theme: { accent: '#00ff00' } }).includes('#ff0000'));
});

test('a beat lasts long enough to read its caption. The packet crosses in speed', () => {
  const say = 'one two three four five six seven eight nine ten';
  const two: FlowProps = {
    ...fig,
    steps: [
      { label: 'a', flow: [{ edges: 'call', say }] },
      { label: 'b', flow: [{ edges: 'call' }] },
    ],
  };
  const svg = toSvg(two);
  const speed = 1000;
  const total = (beatMs({ hops: [], say }, speed) + speed + 2 * STEP_HOLD_MS) / 1000 / BASE_RATE;
  const n2 = (v: number) => Math.round(v * 10) / 10;
  assert.ok(svg.includes(`dur="${n2(total)}s"`), String(n2(total)));
  const motion = svg.match(/keyTimes="0;([\d.]+);([\d.]+);1"/)!;
  assert.equal(Number(motion[2]), Math.round((speed / 1000 / BASE_RATE / total) * 10000) / 10000);
  const beatEnd = beatMs({ hops: [], say }, speed) / 1000 / BASE_RATE / total;
  const op = svg.match(/@keyframes p0 \{[^}]*\}[^}]*\{ opacity: 1 \} ([\d.]+)%,100%/)!;
  assert.ok(Math.abs(Number(op[1]) - beatEnd * 100) < 0.1, op[1]);
});

test('opts.speed sets the travel and the beat length', () => {
  const svg = toSvg({ ...fig, speed: 1000, steps: [{ label: 'a', flow: [{ edges: 'call' }] }] }, { speed: 400 });
  const total = (400 + STEP_HOLD_MS) / 1000 / BASE_RATE;
  const n2 = (v: number) => Math.round(v * 10) / 10;
  assert.ok(svg.includes(`dur="${n2(total)}s"`), String(n2(total)));
  const motion = svg.match(/keyTimes="0;([\d.]+);([\d.]+);1"/)!;
  assert.equal(Number(motion[2]), Math.round((400 / 1000 / BASE_RATE / total) * 10000) / 10000);
});

test('a long loop keeps a real travel window in keyTimes: the packet moves, it does not jump', () => {
  const say = 'one two three four five six seven eight nine ten';
  const fig: FlowProps = {
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    edges: [{ id: 'e', from: 'a', to: 'b' }],
    steps: [{ label: 's', flow: Array.from({ length: 8 }, () => ({ edges: 'e', say })) }],
  };
  const svg = toSvg(fig);
  const times = [...svg.matchAll(/keyTimes="0;([\d.]+);([\d.]+);1"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(times.length >= 8);
  for (const [t0, t1] of times) assert.ok(t1 - t0 > 0.005, `${t0} ${t1}`);
});
