import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSvg, render, check } from './svg.ts';
import { timelineLayout, TL_AXIS_W, TL_BAR_H, DARK, BASE_RATE, STEP_HOLD_MS, beatMs, type FlowProps } from './model.ts';
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

const say = 'one two three four five six seven eight nine ten';
const look = (fill: string, stroke: string, w: number) => `fill: var(--${fill}); stroke: var(--${stroke}); stroke-width: ${w}`;
const ACTIVE_LOOK = look('tint', 'accent', 2) + '; filter: drop-shadow(0 0 4px var(--accent))';
const TRAIL_LOOK = look('bg', 'accent', 1) + '; filter: drop-shadow(0 0 0 transparent)';
const OFF_LOOK = look('bg', 'border', 1) + '; filter: drop-shadow(0 0 0 transparent)';
/** The keyframes of the box with this label. */
const boxFrames = (svg: string, label: string) => {
  const cls = svg.match(new RegExp(`class="(a\\d+)"/><text[^>]*class="label">${label}</text>`))![1];
  return svg.match(new RegExp(`@keyframes ${cls} \\{ ([^\\n]*) \\}`))![1];
};
const chain = (steps: FlowProps['steps'], edges: FlowProps['edges'], ids = ['a', 'b', 'c', 'd']): FlowProps => ({
  speed: 900,
  layout: { children: ids.map((id) => ({ id, label: id.toUpperCase() })) },
  edges,
  steps,
});
const timing = (beats: number, steps = 1) => {
  const beat = beatMs({ hops: [], say }, 900) / 1000 / BASE_RATE;
  const hold = STEP_HOLD_MS / 1000 / BASE_RATE;
  const total = steps * (beats * beat + hold);
  const p = (s: number) => Math.round((s / total) * 10000) / 100 + '%';
  const eps = (s: number) => Math.round((s / total - 0.0001) * 10000) / 100 + '%';
  return { beat, hold, total, p, eps, travel: 900 / 1000 / BASE_RATE };
};

test('a box turns active when the packet arrives, and the ramp back to trail lasts 400 ms', () => {
  const abc = chain(
    [
      {
        label: 's',
        flow: [
          { edges: 'ab', say },
          { edges: 'bc', say },
        ],
      },
    ],
    [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' },
    ],
    ['a', 'b', 'c'],
  );
  const svg = toSvg(abc);
  const { beat, total, p, eps, travel } = timing(2);
  // b: trail until the packet arrives, active to the beat end, then a 400 ms ramp to trail
  const b = boxFrames(svg, 'B');
  assert.ok(b.startsWith(`0%,${eps(travel)} { ${TRAIL_LOOK}`), b);
  assert.ok(b.includes(`${p(travel)},${eps(beat)} { ${ACTIVE_LOOK}`), b);
  assert.ok(b.includes(`${p(beat + 0.4)},${eps(total)} { ${TRAIL_LOOK}`), b);
  // c: off during beat 1, trail until the arrival in beat 2
  const c = boxFrames(svg, 'C');
  assert.ok(c.startsWith(`0%,${eps(beat)} { ${OFF_LOOK}`), c);
  assert.ok(c.includes(`${p(beat + travel)}`), c);
  assert.ok(svg.includes('--tint:color-mix(in srgb, var(--accent) 10%, var(--surface))'));
});

test('the wrap: the last active look ramps to the first look before 100 %', () => {
  const abc = chain(
    [{ label: 's', flow: [{ edges: 'ab', say }] }],
    [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' },
    ],
    ['a', 'b', 'c'],
  );
  const { beat, hold, total, p, eps, travel } = timing(1);
  const b = boxFrames(toSvg(abc), 'B');
  // active through the hold, less the last 400 ms; the ramp to the first look (trail) ends at the loop end
  assert.ok(b.includes(`${p(travel)},${eps(beat + hold - 0.4)} { ${ACTIVE_LOOK}`), b);
  assert.ok(b.endsWith(`${p(total * 0.9998)},${eps(total)} { ${TRAIL_LOOK} }`), b);
  assert.ok(!b.includes('100%'), b);
});

test('the active look lasts through the step hold, for a back hop and for two hops, then ramps to off', () => {
  const svg = toSvg(
    chain(
      [
        { label: 's1', flow: [{ edges: ['ab', { edge: 'cd', back: true }], say }] },
        { label: 's2', flow: [{ edges: 'ab', say }] },
      ],
      [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'cd', from: 'c', to: 'd' },
      ],
    ),
  );
  const { beat, hold, p, eps, travel } = timing(1, 2);
  const step = beat + hold;
  // b (a forward hop) and c (the destination of the back hop) are both active until the step ends
  for (const l of ['B', 'C']) assert.ok(boxFrames(svg, l).includes(`${p(travel)},${eps(step)} { ${ACTIVE_LOOK}`), l);
  // d is the source of the back hop: it stays trail
  assert.ok(!boxFrames(svg, 'D').includes('stroke-width: 2'));
  // c is off in step 2: it ramps from active to off over 400 ms after the step ends
  assert.ok(boxFrames(svg, 'C').includes(`${p(step + 0.4)},${eps(step + beat + hold)} { ${OFF_LOOK}`));
});

test('a red hop colors the packet, the lit edge and the arrival look; the trail stays accent', () => {
  const red = chain(
    [
      {
        label: 's',
        flow: [
          { edges: { edge: 'ab', tone: 'red', data: 'no' }, say },
          { edges: 'bc', say },
        ],
      },
    ],
    [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' },
    ],
    ['a', 'b', 'c'],
  );
  const svg = toSvg(red);
  assert.ok(svg.includes('<circle r="4.5" fill="#ef4444"/>'), 'packet');
  assert.ok(svg.includes('rx="8" fill="color-mix(in srgb, #ef4444 64%, #000)"'), 'data card');
  assert.match(svg, /\{ stroke: #ef4444; stroke-width: 2 \}/, 'lit edge');
  const b = boxFrames(svg, 'B');
  assert.ok(b.includes('stroke: #ef4444; stroke-width: 2; filter: drop-shadow(0 0 4px #ef4444)'), 'active look');
  assert.ok(b.includes('stroke: var(--accent); stroke-width: 1'), 'trail stays accent');
  // the edge of the plain hop stays accent
  assert.ok(svg.includes('{ stroke: var(--accent); stroke-width: 2 }'), 'plain edge');
});

test('a box with a tone has its border and tint in the off look', () => {
  const svg = toSvg({
    layout: {
      children: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C', tone: 'gray' },
      ],
    },
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
    steps: [
      { label: 's', flow: ['a->b'] },
      { label: 't', flow: ['b->c'] },
    ],
  });
  const c = boxFrames(svg, 'C');
  assert.ok(c.includes('fill: color-mix(in srgb, #8b949e 8%, var(--bg)); stroke: #8b949e; stroke-width: 1'), c);
  assert.ok(svg.includes('stroke="#8b949e"'), 'static border');
  assert.ok(toSvg({ layout: { children: [{ id: 'a', label: 'A', tone: 'gray' }] }, edges: [] }).includes('stroke="#8b949e"'), 'no steps');
});

test('the checkout figure keeps its keyframe count when no tone applies (the map and the rail share keyframes)', async () => {
  const { default: fig } = await import('../figures/checkout.ts');
  // 46 is the count in docs/checkout.svg at 6e04605, before tones.
  assert.equal((toSvg(fig.props).match(/@keyframes/g) ?? []).length, 46);
});

const toned: FlowProps = {
  speed: 900,
  rail: 'only',
  layout: {
    children: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C', tone: 'green' },
      { id: 'd', label: 'D', shape: 'store', tone: 'orange' },
      { id: 'e', label: 'E', shape: 'decision', tone: 'purple' },
    ],
  },
  edges: [
    { id: 'ab', from: 'a', to: 'b', label: 'go' },
    { id: 'bc', from: 'b', to: 'c' },
    { id: 'bd', from: 'b', to: 'd' },
    { id: 'be', from: 'b', to: 'e' },
  ],
  steps: [
    {
      label: 's',
      flow: [
        { edges: { edge: 'ab', tone: 'red' }, say },
        { edges: 'bc', say },
        { edges: { edge: 'bd', tone: 'gray' }, say },
        { edges: 'be', say },
      ],
    },
  ],
};

test('a toned hop colors the rail row line and pill', () => {
  const svg = toSvg(toned);
  assert.match(svg, /\{ stroke: #ef4444; stroke-width: 2 \}/, 'rail line');
  assert.ok(svg.includes('fill: color-mix(in srgb, #ef4444 64%, #000); stroke: #ef4444'), 'rail pill');
});

test('a toned hop colors the label pill on the map', () => {
  const svg = toSvg({ ...toned, rail: undefined });
  assert.ok(svg.includes('fill: color-mix(in srgb, #ef4444 64%, #000); stroke: #ef4444'), 'map pill');
});

test('the active look falls back to the box tone, and a hop tone wins over it', () => {
  const svg = toSvg({ ...toned, rail: undefined });
  assert.ok(boxFrames(svg, 'C').includes('stroke: #10b981; stroke-width: 2; filter: drop-shadow(0 0 4px #10b981)'), 'box tone');
  assert.ok(boxFrames(svg, 'D').includes('stroke: #8b949e; stroke-width: 2'), 'hop tone (gray) over box tone (orange)');
  assert.ok(!boxFrames(svg, 'D').includes('drop-shadow(0 0 4px #f59e0b)'), 'box tone not used');
});

test('a toned store and a toned decision have the tone border in the static markup', () => {
  const svg = toSvg({ ...toned, rail: undefined });
  const tones = (svg.match(/stroke="#(f59e0b|a855f7)"/gi) ?? []).length;
  assert.ok(tones >= 2, `store and decision borders: ${tones}`);
  assert.ok(svg.includes('stroke: #8b5cf6; stroke-width: 2'), 'decision active look');
});

test('a toned box that is never lit has no animation', () => {
  const svg = toSvg({
    layout: {
      children: [
        { id: 'a', label: 'A', tone: 'gray' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    },
    edges: [{ from: 'b', to: 'c' }],
    steps: [{ label: 's', flow: ['b->c'] }],
  });
  assert.ok(!/class="a\d+"\/><text[^>]*class="label">A</.test(svg));
});

test('the arrowhead takes the edge color', () => {
  assert.ok(toSvg(toned).includes('fill="context-stroke"'));
});

const lanesFig: FlowProps = {
  lanes: true,
  layout: {
    direction: 'column',
    children: [
      {
        label: 'Customer',
        children: [
          { id: 'ask', label: 'Request refund' },
          { id: 'get', label: 'Get money' },
        ],
      },
      {
        label: 'Support',
        children: [
          { id: 'check', label: 'Check order' },
          { id: 'reject', label: 'Reject' },
        ],
      },
      {
        label: 'Finance',
        children: [
          { id: 'pay', label: 'Issue refund' },
          { id: 'audit', label: 'Audit', at: 1 },
        ],
      },
    ],
  },
  edges: [
    { id: 'a', from: 'ask', to: 'check' },
    { id: 'b', from: 'check', to: 'pay' },
    { id: 'c', from: 'pay', to: 'get' },
    { id: 'r', from: 'check', to: 'reject' },
  ],
  steps: [
    { label: 'ok', flow: ['a', 'b', { edge: 'c', back: true }] },
    { label: 'no', flow: ['a', 'r'] },
  ],
};

test('lanes: boxes in one time column share x across lanes; the bands span the width; a lane label sits in the gutter', () => {
  const { scene, svg } = render(lanesFig);
  const rect = (id: string) => scene.boxes.find((b) => b.id === id)!.rect;
  assert.equal(rect('check').x, rect('audit').x); // both column 1
  assert.ok(rect('ask').x < rect('check').x && rect('check').x < rect('pay').x);
  assert.ok(rect('ask').y < rect('check').y && rect('check').y < rect('pay').y); // lane order top to bottom
  assert.match(svg, /CUSTOMER/);
  const bands = [...svg.matchAll(/<rect[^>]*class="lane[ "][^>]*>/g)];
  assert.equal(bands.length, 3);
});

test('lanes: an empty lane still draws, a decision widens its column, and the rail works under lanes', () => {
  const [customer, , finance] = lanesFig.layout.children;
  const fig: FlowProps = {
    ...lanesFig,
    rail: true,
    layout: {
      direction: 'column',
      children: [
        customer,
        {
          label: 'Support',
          children: [
            { id: 'check', label: 'Check order', shape: 'decision' },
            { id: 'reject', label: 'Reject' },
          ],
        },
        finance,
        { label: 'Empty', children: [] },
      ],
    },
  };
  const { svg, scene } = render(fig);
  assert.match(svg, /EMPTY/);
  const w = (id: string) => scene.boxes.find((b) => b.id === id)!.rect.w;
  assert.ok(w('check') > w('ask'));
  assert.equal(check(fig).filter((f) => f.severity === 'error').length, 0);
});

test('lanes: a box at the top draws the normal layout and check reports the rule; the bands do not touch', () => {
  const top: FlowProps = { lanes: true, layout: { direction: 'row', children: [{ id: 'a', label: 'A' }] }, edges: [] };
  assert.ok(check(top).some((f) => f.rule === 'lanes-need-column'));
  const { scene } = render(lanesFig);
  const y = (id: string) => scene.boxes.find((b) => b.id === id)!.rect.y;
  assert.ok(y('check') - y('ask') > 20 + 2 * 24); // a lane band plus the gap between bands
  const bad: FlowProps = {
    ...lanesFig,
    layout: { direction: 'column', children: [{ label: 'One', children: [{ id: 'p', label: 'P', at: -1 }] }] },
    edges: [],
    steps: [],
  };
  assert.ok(!render(bad).svg.includes('NaN'));
});

test('marks: a start dot and an end ring sit in the gap, and the scene is unchanged', () => {
  const marked: FlowProps = {
    ...fig,
    layout: {
      children: [
        { id: 'checkout', label: 'Checkout', mark: 'start' },
        { id: 'store', label: 'Orders', shape: 'store', mark: 'end' },
      ],
    },
  };
  const plain: FlowProps = {
    ...marked,
    layout: {
      children: [
        { id: 'checkout', label: 'Checkout' },
        { id: 'store', label: 'Orders', shape: 'store' },
      ],
    },
  };
  const a = render(marked);
  const b = render(plain);
  assert.deepEqual(a.scene, b.scene);
  const [box, end] = a.scene.boxes.map((b) => b.rect);
  assert.ok(
    a.svg.includes(`<circle cx="${+(box.x - 12).toFixed(2)}" cy="${+(box.y + box.h / 2).toFixed(2)}" r="5" fill="var(--accent)"/>`),
  );
  const cx = +(end.x + end.w + 12).toFixed(2);
  assert.ok(
    a.svg.includes(
      `<circle cx="${cx}" cy="${+(end.y + end.h / 2).toFixed(2)}" r="6.25" fill="none" stroke="var(--accent)" stroke-width="1.5"/>`,
    ),
  );
  assert.ok(a.svg.includes(`<circle cx="${cx}" cy="${+(end.y + end.h / 2).toFixed(2)}" r="4" fill="var(--accent)"/>`));
  assert.ok(!b.svg.includes('r="6.25"'));
});

const tlFig: FlowProps = {
  timeline: true,
  today: '2026-10-14',
  layout: {
    direction: 'column',
    children: [
      {
        id: 'prod',
        label: 'Product',
        children: [
          { id: 'spec', label: 'Spec', from: '2026-10-05', to: '2026-10-16' },
          { id: 'build', label: 'Build', from: '2026-10-19', to: '2026-11-06' },
        ],
      },
      { id: 'launch', label: 'Launch', children: [{ id: 'ga', label: 'GA', from: '2026-11-09' }] },
    ],
  },
  edges: [{ from: 'spec', to: 'build' }],
};
const n1 = (v: number) => Math.round(v * 10) / 10;

test('timeline: the axis has the week ticks, the bars sit at the layout x and a milestone is a diamond', () => {
  const { svg, scene } = render(tlFig);
  const lay = timelineLayout(tlFig, TL_AXIS_W);
  for (const k of lay.ticks) assert.ok(svg.includes(`>${k.label}</text>`), k.label);
  assert.equal(svg.match(/class="tick"/g)?.length, lay.ticks.length);
  const spec = scene.boxes.find((b) => b.id === 'spec')!;
  const item = lay.items.find((i) => i.id === 'spec')!;
  assert.equal(spec.rect.w, item.w);
  assert.equal(spec.rect.h, TL_BAR_H);
  assert.ok(svg.includes(`width="${n1(item.w)}" height="${TL_BAR_H}" rx="6"`), 'bar rect');
  assert.equal(svg.match(/<polygon /g)?.length, 1, 'one diamond');
  assert.deepEqual(scene.boxes.map((b) => b.id).sort(), ['build', 'ga', 'spec']);
  assert.ok(scene.boxes.every((b) => b.texts[0].fontSize === 13));
});

test('timeline: the today line moves to each item and home in the step hold; the steps come from the dates', () => {
  const svg = toSvg(tlFig);
  assert.ok(svg.includes('class="today">today<'));
  const line = svg.match(/<g class="(a\d+)"><path [^>]*stroke="var\(--accent\)" stroke-width="1.5"/)!;
  const kf = svg.match(new RegExp(`@keyframes ${line[1]} \\{[^\\n]*\\}\\n`))![0];
  assert.ok(kf.includes('translateX(0px)'), 'home at the start and end');
  assert.ok(/translateX\(-\d/.test(kf), 'a beat moves the line left of today');
  assert.ok(svg.includes('Spec') && !svg.includes('>timeline</text>'), 'the synthetic step has no label');
});

test('timeline: an item with a bad date is skipped and the output has no NaN; check on a valid timeline has no error', () => {
  const bad: FlowProps = {
    ...tlFig,
    layout: {
      direction: 'column',
      children: [
        {
          id: 't',
          label: 'T',
          children: [
            { id: 'x', label: 'X', from: '2026-13-45', to: '2026-10-02' },
            { id: 'spec', label: 'Spec', from: '2026-10-05', to: '2026-10-16' },
          ],
        },
      ],
    },
    edges: [{ from: 'x', to: 'spec' }],
  };
  const { svg, scene } = render(bad);
  assert.ok(!svg.includes('NaN'));
  assert.ok(!scene.boxes.some((b) => b.id === 'x'));
  assert.equal(check(tlFig).filter((f) => f.severity === 'error').length, 0);
});
