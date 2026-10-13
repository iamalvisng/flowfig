import { diff, formatDiff, render, type DiffMarks } from './svg.ts';
import {
  BASE_RATE,
  DARK,
  LIGHT,
  STEP_HOLD_MS,
  beatMs,
  edgeId,
  isGroup,
  nodes,
  str,
  toBeat,
  type FigGroup,
  type FlowProps,
} from './model.ts';
import { moments, worldReady, type Moment } from './explain.ts';
import { HUD, TOKENS } from './looks.ts';
import type { World } from './world.ts';

type Form = 'diagram' | 'guide' | 'change';
type Spot = Moment & { step: string; ms: number; code: string[]; title: string };
type El = HTMLElement;
type Side = { name: string; spec: FlowProps; svg: SVGSVGElement; out: El; tile: El };
type Guide = {
  ht: El;
  kick: El;
  say: El;
  note: El;
  code: El;
  skip: El;
  list: El;
  key: El;
  items: HTMLButtonElement[];
  chips: HTMLButtonElement[];
  tog: HTMLButtonElement;
  more: HTMLButtonElement;
  stage: El;
  diagram?: El;
  ready: boolean;
  step: string;
  last: number;
  lastStep: string;
  drawn: string;
};

const KEYS = { data: 'Data through the air', thing: 'Things on the road or by hand', check: 'A check' };

const FORMS: Form[] = ['diagram', 'guide', 'change'];
const tokens = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--flowfig-${k}:${v};`)
    .join('');
const svgVars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join('');

const CSS = [
  `:host{display:block;container:ff-host/inline-size;${tokens(TOKENS.light)}}`,
  `:host([theme=dark]){${tokens(TOKENS.dark)}}`,
  `@media (prefers-color-scheme:dark){:host(:not([theme=light])){${tokens(TOKENS.dark)}}}`,
  // Important rules from the shadow tree win over the page (CSS Cascade 4).
  ':host{color:var(--flowfig-ink)!important;font-size:15px!important;font-family:var(--flowfig-font)!important;line-height:1.5!important;letter-spacing:normal!important}',
  `:host([theme=light]) svg[role=img]{${svgVars(LIGHT)}}`,
  `:host([theme=dark]) svg[role=img]{${svgVars(DARK)}}`,
  ':host(:focus-visible),:focus-visible{outline:2px solid var(--flowfig-accent);outline-offset:2px}',
  '[hidden]{display:none!important}',
  '.ff-root{display:grid;gap:12px;padding:16px;background:var(--flowfig-bg);border:1px solid var(--flowfig-border);border-radius:12px}',
  '.ff-title{margin:0;font-size:18px;font-weight:600}',
  '.ff-row{display:flex;flex-wrap:wrap;gap:6px}',
  'button{font:inherit;font-size:13px;color:inherit;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:999px;padding:4px 12px;cursor:pointer}',
  'button[aria-pressed=true]{background:var(--flowfig-accent);border-color:var(--flowfig-accent);color:var(--flowfig-on-accent)}',
  'button:disabled{cursor:default;opacity:.5}',
  '.ff-pane{overflow-x:auto}',
  '.ff-pane>svg{display:block;width:100%;height:auto;min-width:var(--ff-min);max-width:var(--ff-max);margin:0 auto}',
  '.ff-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}',
  '.ff-alert{margin:0;color:var(--flowfig-bad)}',
  '.ff-g{position:relative;box-sizing:border-box;width:100%;height:100%;aspect-ratio:16/10;max-height:100vh;display:flex;flex-direction:column;gap:0;padding:0;border:0;overflow:hidden}',
  '.ff-row:empty{display:none}',
  '.ff-g>.ff-row{padding:8px 12px 0}',
  '.ff-g>.ff-view{position:relative;flex:1;min-height:0}',
  '.ff-guide{position:relative;height:100%;overflow:hidden;container:ff-guide/size}',
  '.ff-stage{position:absolute;inset:0}',
  '.ff-stage[data-stage=world]{background:#E8ECE3}',
  '.ff-stage[data-stage=diagram]{background:var(--flowfig-bg)}',
  '.ff-stage>.ff-pane{position:absolute;inset:0;overflow:auto}',
  `.ff-chips{position:absolute;top:${HUD.pad}px;left:${HUD.pad * 2 + HUD.panel}px;right:${HUD.pad}px;display:flex;gap:8px;overflow-x:auto}`,
  '.ff-chip{flex:none;font-size:14px}',
  '.ff-chip[aria-pressed=true]{background:var(--flowfig-ink);border-color:var(--flowfig-ink);color:var(--flowfig-bg)}',
  `.ff-hud{position:absolute;top:${HUD.pad}px;left:${HUD.pad}px;bottom:${HUD.pad}px;width:${HUD.panel}px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:20px;overflow:auto;background:var(--flowfig-surface);color:var(--flowfig-ink);border:1px solid var(--flowfig-border);border-radius:8px}`,
  '.ff-ht{margin:0;font-size:15px;font-weight:600}',
  '.ff-kick{margin:0;font-size:13px;color:var(--flowfig-muted)}',
  '.ff-say{margin:0;font-size:22px;line-height:1.25;font-weight:650}',
  '.ff-note{margin:0;font-size:15px;line-height:1.4;color:var(--flowfig-muted)}',
  '.ff-note.ff-bad{color:var(--flowfig-bad)}',
  '.ff-code{margin:0;padding:8px 12px;max-height:160px;overflow:auto;font:13px/1.45 ui-monospace,Menlo,monospace;white-space:pre;background:var(--flowfig-bg);border:1px solid var(--flowfig-border);border-radius:6px}',
  '.ff-lbl{margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--flowfig-muted)}',
  '.ff-skip ul{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;font-size:13px;color:var(--flowfig-muted)}',
  '.ff-moments{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}',
  '.ff-moments button{display:flex;gap:10px;width:100%;box-sizing:border-box;padding:6px 8px;border:0;border-radius:6px;background:none;font-size:13px;text-align:left}',
  '.ff-moments button[aria-current=true]{background:var(--flowfig-bg);font-weight:600}',
  '.ff-moments .ff-fail{color:var(--flowfig-bad)}',
  '.ff-mk{flex:none;min-width:14px;text-align:center}',
  '.ff-ctl{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto}',
  '.ff-b{padding:6px 16px;font-size:14px;font-weight:600;border-radius:8px}',
  '.ff-next{background:var(--flowfig-accent);border-color:var(--flowfig-accent);color:var(--flowfig-on-accent)}',
  '.ff-back::before{content:"\\2190  "/""}',
  '.ff-next::after{content:"  \\2192"/""}',
  '.ff-more{display:none}',
  '.ff-key{margin:0;padding:12px 0 0;list-style:none;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--flowfig-border);font-size:13px;color:var(--flowfig-muted)}',
  '.ff-key li::before{content:"";display:inline-block;width:18px;height:0;margin-right:10px;vertical-align:middle;border-top:2px solid #2456D6}',
  '.ff-key li[data-k=thing]::before{height:10px;border:0;background:#D9822B;border-radius:2px}',
  '.ff-key li[data-k=check]::before{height:10px;border:0;border-top:3px solid #2e3440}',
  `@container ff-host (width < ${HUD.wide}px){.ff-g{aspect-ratio:auto;height:min(100svh,${HUD.tall}px);max-height:none}.ff-chips{top:8px;left:8px;right:8px}.ff-hud{top:auto;left:0;right:0;bottom:0;width:auto;height:${HUD.sheet}px;gap:8px;padding:12px 16px;border-radius:12px 12px 0 0;font-size:13px}.ff-say{font-size:16px}.ff-note{font-size:13px}.ff-kick,.ff-moments button,.ff-key{font-size:11px}.ff-ht,.ff-code,.ff-tog,.ff-moments:not(.ff-open){display:none}.ff-more{display:inline-block}}`,
  `@container ff-guide (${HUD.slim * 2}px <= width < ${HUD.wide}px) and (height < ${HUD.short}px){.ff-chips{top:${HUD.pad}px;left:${HUD.pad * 2 + HUD.slim}px;right:${HUD.pad}px}.ff-hud{top:${HUD.pad}px;left:${HUD.pad}px;right:auto;bottom:${HUD.pad}px;width:${HUD.slim}px;height:auto;border-radius:8px}}`,
  '.ff-verdict{padding:12px 16px;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:10px;font-size:16px;font-weight:500}',
  '.ff-list{margin:6px 0 0;padding-left:20px;font-size:15px;font-weight:400}',
  '.ff-all{margin-top:8px;font-size:13px;font-weight:400;color:var(--flowfig-muted)}',
  '.ff-all summary{cursor:pointer}',
  '.ff-all pre{margin:6px 0 0;max-height:12em;overflow:auto;font:13px/1.45 ui-monospace,Menlo,monospace;color:var(--flowfig-ink);white-space:pre-wrap}',
  '.ff-tiles{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
  '.ff-tile{padding:8px 14px;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:10px}',
  '.ff-out{margin:2px 0 0;min-height:1.5em;font-size:16px;font-weight:600}',
  '.ff-out:empty::before{content:"Press a step to compare";color:var(--flowfig-muted);font-weight:400}',
  '.ff-wait .ff-out:empty::before{content:"Playing…"}',
  '.ff-none .ff-out{color:var(--flowfig-muted);font-weight:400}',
  '.ff-tile.ff-bad{border-color:var(--flowfig-bad)}',
  '.ff-bad .ff-out{color:var(--flowfig-bad)}',
  '.ff-tile.ff-good{border-color:var(--flowfig-good)}',
  '.ff-good .ff-out{color:var(--flowfig-good)}',
  '.ff-sides{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}',
  '.ff-sides.ff-big{grid-template-columns:minmax(0,1fr)}',
  '@container ff-host (width < 700px){.ff-sides{grid-template-columns:minmax(0,1fr)}}',
  '.ff-side{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px 14px;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:12px}',
  '.ff-sh{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.ff-sh h3{margin:0;font-size:15px;font-weight:600}',
  '.ff-sides:not(.ff-big) .ff-pane{cursor:zoom-in}',
  '.ff-sides:not(.ff-big) .ff-pane>svg{min-width:0}',
  '.ff-big .ff-pane{max-height:80vh;overflow:auto}',
  '.ff-side svg[role=img]{--accent:var(--flowfig-play)!important}',
  '[data-diff] :is(rect,path:not([stroke=none]),polygon){stroke:var(--flowfig-accent)!important;filter:none!important}',
  '[data-diff] :is(rect,polygon,path:not([fill=none])){fill:color-mix(in srgb,var(--flowfig-accent) 8%,var(--bg))!important}',
  'rect[data-diff]{fill:var(--flowfig-accent)}',
  '[data-diff] text{fill:var(--fg)!important}',
  '@media (prefers-reduced-motion:reduce){.ff-guide *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}',
].join('\n');

let sheet: CSSStyleSheet | undefined;

const clock = (spec: FlowProps, label: string) => {
  const speed = spec.speed ?? 900;
  let start = 0;
  for (const s of spec.steps ?? []) {
    const ms = s.flow.reduce((a, b) => a + beatMs(toBeat(b), speed), 0);
    if (str(s.label) === label) return [start, ms];
    start += ms + (s.flow.length ? STEP_HOLD_MS : 0);
  }
  return [start, 0];
};

// The SVG fades the last step out in its final 400 ms.
const endOf = (spec: FlowProps, label: string) => {
  const [start, ms] = clock(spec, label);
  return start + ms + STEP_HOLD_MS / 2;
};

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const seek = (svg: SVGSVGElement, ms: number, run = false) => {
  const t = ms / BASE_RATE;
  if (run) svg.unpauseAnimations();
  else svg.pauseAnimations();
  svg.setCurrentTime(t / 1000);
  for (const a of svg.getAnimations({ subtree: true })) {
    // The reduced-motion rule of the SVG sets a negative animation-delay.
    a.effect?.updateTiming({ delay: 0 });
    if (run) a.play();
    else a.pause();
    a.currentTime = t;
  }
};

const pane = (spec: FlowProps, opts?: Parameters<typeof render>[1]) => {
  const { svg, scene } = render(spec, opts);
  const p = h('div', 'ff-pane');
  p.innerHTML = svg;
  p.style.setProperty('--ff-min', `${(scene.width * 11) / scene.minFont}px`);
  p.style.setProperty('--ff-max', `${scene.width}px`);
  return p;
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...kids);
  return e;
};

const button = (name: string, onClick: () => void, pressed?: boolean) => {
  const b = h('button', 'ff-btn', name);
  b.type = 'button';
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
};

async function read(url: string): Promise<{ props: FlowProps; title: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let data;
    if (text.trimStart().startsWith('<')) {
      const meta = new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('metadata#figure-spec');
      if (!meta) throw new Error('no figure spec inside this SVG');
      data = JSON.parse(meta.textContent ?? '');
    } else data = JSON.parse(text);
    const props = data?.props ?? data;
    if (!props?.layout) throw new Error('no figure props (expected { props: { layout, edges, steps } })');
    return { props, title: str(data.title) };
  } catch (e) {
    throw new Error(`${url}: ${(e as Error).message}`);
  }
}

const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

export class FlowfigExplain extends Base {
  static observedAttributes = ['src', 'before', 'form', 'step', 'theme', 'code', 'forms'];

  #spec?: FlowProps;
  #before?: FlowProps;
  #title = '';
  #name = 'spec';
  #all: Spot[] = [];
  #at = 0;
  #loads = { src: 0, before: 0 };
  #timer?: ReturnType<typeof setTimeout>;
  #shown?: Form;
  #seeked?: string;
  #played?: string;
  #svg?: SVGSVGElement;
  #g?: Guide;
  #world?: World;
  #worldLoads = 0;
  #motion = 0;
  #seekTimer?: ReturnType<typeof setTimeout>;
  #sides?: Side[];
  #ends: (ReturnType<typeof setTimeout> | undefined)[] = [];
  #tabs: HTMLButtonElement[] = [];
  #ctl: Record<string, HTMLButtonElement> = {};
  #heading = h('h2', 'ff-title');
  #forms = h('div', 'ff-row');
  #view = h('div', 'ff-view');
  #live = h('p', 'ff-live');
  #root = h('div', 'ff-root');

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
    }
    root.adoptedStyleSheets = [sheet];
    this.#live.setAttribute('aria-live', 'polite');
    const title = document.createElement('slot');
    title.name = 'title';
    title.append(this.#heading);
    const caption = document.createElement('slot');
    caption.name = 'caption';
    this.#root.append(title, this.#forms, this.#view, this.#live, caption);
    root.append(this.#root);
    this.addEventListener('keydown', this.#key);
  }

  connectedCallback() {
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    for (const k of ['spec', 'beforeSpec', 'moment'] as const) {
      if (!Object.hasOwn(this, k)) continue;
      const v = this[k];
      delete (this as Partial<this>)[k];
      (this as Record<typeof k, unknown>)[k] = v;
    }
    if (this.#spec && this.#g && !this.#world && this.#g.ready) this.#draw();
  }

  disconnectedCallback() {
    this.pause();
    clearTimeout(this.#seekTimer);
    this.#world?.stop();
    this.#world = undefined;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src' || name === 'before') void this.#load(name);
    else if (name === 'step') {
      if (value) this.show(value);
    } else if (name === 'code' && this.#g) {
      this.#g.tog.setAttribute('aria-pressed', String(value !== null));
      this.#update();
    } else if (name !== 'theme') this.#draw();
  }

  get spec() {
    return this.#spec;
  }
  set spec(v: FlowProps | undefined) {
    this.#loads.src++;
    this.#spec = v;
    this.#title = '';
    this.#name = 'spec';
    this.#draw(true);
  }

  get beforeSpec() {
    return this.#before;
  }
  set beforeSpec(v: FlowProps | undefined) {
    this.#loads.before++;
    this.#before = v;
    this.#draw();
  }

  get moment() {
    return this.#at;
  }
  set moment(i: number) {
    const at = Math.min(Math.max(0, Math.trunc(i) || 0), Math.max(0, this.#all.length - 1));
    if (at === this.#at) return;
    this.#at = at;
    this.#update();
    this.#emit();
  }

  next() {
    this.moment = this.#at + 1;
  }

  back() {
    this.moment = this.#at - 1;
  }

  play() {
    this.pause();
    const tick = () => {
      if (this.#at >= this.#all.length - 1) return this.pause();
      this.#timer = setTimeout(() => {
        this.next();
        tick();
      }, this.#motion + this.#all[this.#at].ms);
      this.#update();
    };
    tick();
  }

  pause() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#ctl.play) this.#update();
  }

  show(stepLabel: string) {
    const i = this.#all.findIndex((m) => m.step === stepLabel);
    if (i >= 0) this.moment = i;
  }

  #labels() {
    const of = (spec?: FlowProps) => (spec?.steps ?? []).map((s) => str(s.label));
    return this.#sides ? [...new Set([...of(this.#spec), ...of(this.#before)])] : of(this.#spec);
  }

  #pick(label: string) {
    if (this.#sides && !this.#all.some((m) => m.step === label)) return this.#run(label);
    this.#seeked = undefined;
    this.show(label);
    this.#update();
  }

  #run(label: string) {
    this.#ends.forEach(clearTimeout);
    this.#played = label;
    for (const t of this.#tabs) t.setAttribute('aria-pressed', String(t.textContent === label));
    const calm = still();
    this.#ends = (this.#sides ?? []).map((s) => {
      const step = s.spec.steps?.find((x) => str(x.label) === label);
      s.out.textContent = step ? '' : `This step is not in ${s.name}`;
      s.tile.className = `ff-tile ${step ? 'ff-wait' : 'ff-none'}`;
      if (!step) return void seek(s.svg, 0);
      const start = clock(s.spec, label)[0];
      const end = endOf(s.spec, label);
      const hop = step.flow.flatMap((b) => toBeat(b).hops).at(-1);
      const edge = s.spec.edges.find((e) => edgeId(e) === hop?.edge);
      const tone = nodes(s.spec.layout).find((n) => n.id === (hop?.back ? edge?.from : edge?.to))?.tone;
      seek(s.svg, calm ? end : start, !calm);
      return setTimeout(
        () => {
          seek(s.svg, end);
          s.out.textContent = moments(s.spec, label).at(-1)?.summary?.outcome ?? '';
          s.tile.className = `ff-tile${tone === 'red' || tone === 'gray' ? ' ff-bad' : tone === 'green' ? ' ff-good' : ''}`;
        },
        calm ? 0 : (end - start) / BASE_RATE,
      );
    });
  }

  #stepBy(d: number) {
    const labels = this.#labels();
    const i = labels.indexOf((this.#sides ? this.#played : this.#all[this.#at]?.step) ?? '');
    const next = labels[Math.min(Math.max(0, i + d), labels.length - 1)];
    if (next !== undefined) {
      if (this.#sides) this.#pick(next);
      else this.show(next);
    }
  }

  #key = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== ' ') this.pause();
    const guide = this.#shown === 'guide';
    if (e.key === 'ArrowRight') {
      if (guide) this.next();
      else this.#stepBy(1);
    } else if (e.key === 'ArrowLeft') {
      if (guide) this.back();
      else this.#stepBy(-1);
    } else if (e.key === ' ' && e.composedPath()[0] === this) {
      if (this.#timer) this.pause();
      else this.play();
    } else if (/^[1-9]$/.test(e.key)) {
      const label = this.#labels()[Number(e.key) - 1];
      if (label !== undefined) this.#pick(label);
    } else return;
    e.preventDefault();
  };

  async #load(key: 'src' | 'before') {
    const n = ++this.#loads[key];
    const url = this.getAttribute(key);
    if (!url) return;
    try {
      const { props, title } = await read(url);
      if (n !== this.#loads[key]) return;
      if (key === 'before') {
        this.#before = props;
        return this.#draw();
      }
      this.#spec = props;
      this.#title = title;
      this.#name = url;
      this.#draw(true);
    } catch (e) {
      if (n === this.#loads[key]) this.#fault((e as Error).message);
    }
  }

  #fault(message: string) {
    this.pause();
    clearTimeout(this.#seekTimer);
    this.#world?.stop();
    this.#world = undefined;
    this.#worldLoads++;
    this.#all = [];
    this.#at = 0;
    this.#svg = undefined;
    this.#tabs = [];
    this.#ctl = {};
    this.#forms.replaceChildren();
    this.#live.textContent = '';
    const alert = h('p', 'ff-alert', message);
    alert.setAttribute('role', 'alert');
    this.#view.replaceChildren(alert);
  }

  #draw(reset = false) {
    const spec = this.#spec;
    if (!spec) return;
    try {
      if (reset) {
        this.pause();
        const speed = spec.speed ?? 900;
        const edges = new Map(spec.edges.map((e) => [edgeId(e), e]));
        const boxes = new Map(nodes(spec.layout).map((n) => [n.id, n]));
        this.#all = (spec.steps ?? []).flatMap((s) => {
          const label = str(s.label);
          const beats = s.flow.map(toBeat);
          return moments(spec, label).map((m, k) => {
            const hops = beats[k]?.hops ?? [];
            const last = hops.at(-1);
            const code = hops.flatMap((hp) => {
              const e = edges.get(hp.edge);
              return [hp.source, hp.via, e?.source, e?.via, boxes.get(e?.from ?? '')?.source, boxes.get(e?.to ?? '')?.source];
            });
            return {
              ...m,
              step: label,
              title: m.summary
                ? 'Outcome'
                : m.question ||
                  str(boxes.get((last?.back ? edges.get(last.edge)?.from : edges.get(last?.edge ?? '')?.to) ?? '')?.label) ||
                  m.say,
              ms: k < beats.length ? beatMs(beats[k], speed) : STEP_HOLD_MS,
              code: [...new Set(code.filter((c): c is string => !!c))],
            };
          });
        });
        const step = this.getAttribute('step');
        this.#at = Math.max(0, step ? this.#all.findIndex((m) => m.step === step) : 0);
      }
      const allowed = FORMS.filter((f) => (f === 'guide' ? !!spec.steps?.length : f === 'change' ? !!this.#before : true));
      const listed = this.getAttribute('forms')?.split(/\s+/);
      const forms = listed ? allowed.filter((f) => listed.includes(f)) : allowed;
      const asked = this.getAttribute('form') as Form | null;
      const form = asked && forms.includes(asked) ? asked : forms.includes('guide') ? 'guide' : (forms[0] ?? 'diagram');

      this.#forms.replaceChildren(...(forms.length > 1 ? forms.map((f) => button(f, () => this.setAttribute('form', f), f === form)) : []));
      clearTimeout(this.#seekTimer);
      this.#world?.stop();
      this.#world = undefined;
      this.#worldLoads++;
      this.#motion = 0;
      this.#heading.textContent = this.#title;
      this.#heading.hidden = !this.#title || form === 'guide';
      this.#svg = undefined;
      this.#g = undefined;
      this.#sides = undefined;
      this.#played = undefined;
      this.#root.classList.toggle('ff-g', form === 'guide');
      this.#seeked = undefined;
      this.#tabs = [];
      this.#ctl = {};
      this.#view.replaceChildren();
      if (asked === 'change' && !this.#before && !this.hasAttribute('before')) {
        const alert = h('p', 'ff-alert', `${this.#name}: the change form needs a before spec`);
        alert.setAttribute('role', 'alert');
        this.#view.append(alert);
      }
      if (form === 'diagram') {
        const p = pane(spec);
        this.#svg = p.querySelector('svg') ?? undefined;
        this.#tabs = this.#labels().map((label) => button(label, () => this.show(label), false));
        this.#view.append(p, h('div', 'ff-row', ...this.#tabs));
      } else if (form === 'change' && this.#before) {
        const changes = diff(this.#before, spec);
        const zoom = (col?: El) => {
          wide.classList.toggle('ff-big', !!col);
          for (const c of wide.children as HTMLCollectionOf<El>) {
            c.hidden = !!col && c !== col;
            const b = c.querySelector('button')!;
            b.textContent = col ? 'Back to both' : 'Enlarge';
            b.setAttribute('aria-label', col ? 'Back to both' : `Enlarge ${c.querySelector('h3')!.textContent}`);
          }
          const label = this.#played;
          for (const s of this.#sides!) seek(s.svg, label && s.spec.steps?.some((x) => str(x.label) === label) ? endOf(s.spec, label) : 0);
        };
        const side = (name: string, of: FlowProps, ops: string[], scope: string): Side => {
          const marks: DiffMarks = { boxes: {}, edges: {}, steps: 0 };
          for (const c of changes)
            if (ops.includes(c.op) && (c.kind === 'box' || c.kind === 'edge')) marks[c.kind === 'box' ? 'boxes' : 'edges'][c.id] = c.op;
          const p = pane(of, { marks, scope });
          const big = button('Enlarge', () => zoom(wide.classList.contains('ff-big') ? undefined : col));
          big.setAttribute('aria-label', `Enlarge ${name}`);
          const col = h('section', 'ff-side', h('div', 'ff-sh', h('h3', '', name), big), p);
          p.addEventListener('click', () => wide.classList.contains('ff-big') || zoom(col));
          const out = h('p', 'ff-out');
          out.dataset.outcome = '';
          out.setAttribute('aria-live', 'polite');
          const tile = h('div', 'ff-tile', h('span', 'ff-lbl', name), out);
          tile.dataset.side = name.toLowerCase();
          wide.append(col);
          return { name, spec: of, svg: p.querySelector('svg')!, out, tile };
        };
        const wide = h('div', 'ff-sides');
        this.#sides = [side('Before', this.#before, ['removed', 'changed'], 'b'), side('After', spec, ['added', 'changed'], 'a')];
        const where = (g: FigGroup, up: string, at: Map<string, string[]>): Map<string, string[]> => {
          for (const c of g.children)
            if (isGroup(c)) where(c, c.label == null ? up : str(c.label), at);
            else at.set(c.id, [str(c.label) || c.id, up]);
          return at;
        };
        const was = where(this.#before.layout, '', new Map());
        const now = where(spec.layout, '', new Map());
        const name = (id: string) => (now.get(id) ?? was.get(id))?.[0] ?? id;
        const rank: Record<string, number> = { box: 0, step: 1, edge: 2 };
        const plain = changes
          .filter((c) => c.kind in rank)
          .sort((a, b) => rank[a.kind] - rank[b.kind])
          .map((c) => {
            const op = c.op === 'added' ? 'Added' : c.op === 'removed' ? 'Removed' : 'Changed';
            if (c.kind === 'step') return `${op} step: ${c.id}`;
            if (c.kind === 'edge') return `${op} link: ${c.id.split('->').map(name).join(' → ')}`;
            const [from, to] = [was.get(c.id)?.[1], now.get(c.id)?.[1]];
            return c.op === 'changed' && from !== to
              ? `Moved: ${name(c.id)}, ${[from && `from ${from}`, to && `to ${to}`].filter(Boolean).join(' ')}`
              : `${op}: ${name(c.id)}`;
          });
        const verdict = document.createElement('slot');
        verdict.name = 'verdict';
        verdict.append(
          h('p', 'ff-lbl', 'What changed'),
          h(
            'ul',
            'ff-list',
            ...[...plain.slice(0, 6), ...(plain.length > 6 ? [`and ${plain.length - 6} more`] : [])].map((t) => h('li', '', t)),
          ),
        );
        this.#tabs = this.#labels().map((label) => button(label, () => this.#pick(label), false));
        this.#view.append(
          h(
            'div',
            'ff-verdict',
            verdict,
            h('details', 'ff-all', h('summary', '', 'Show all changes'), h('pre', '', formatDiff(changes, 'text'))),
          ),
          h('div', 'ff-row', ...this.#tabs),
          h('div', 'ff-tiles', ...this.#sides.map((s) => s.tile)),
          wide,
        );
        for (const s of this.#sides) seek(s.svg, 0);
        this.#seeked = this.#all[this.#at]?.step;
      } else if (form === 'guide') {
        this.#ctl = {
          back: button('Back', () => this.back()),
          play: button('Play', () => (this.#timer ? this.pause() : this.play())),
          next: button('Next', () => this.next()),
        };
        this.#ctl.back.className = 'ff-btn ff-b ff-back';
        this.#ctl.play.className = 'ff-btn ff-b';
        this.#ctl.next.className = 'ff-btn ff-b ff-next';
        const chip = (label: string, onClick: () => void, pressed: boolean) => {
          const b = button(label, onClick, pressed);
          b.className = 'ff-btn ff-chip';
          return b;
        };
        const ready = worldReady(spec);
        const g: Guide = {
          ht: h('h2', 'ff-ht', this.#title),
          kick: h('p', 'ff-kick'),
          say: h('h3', 'ff-say'),
          note: h('p', 'ff-note'),
          code: h('pre', 'ff-code'),
          skip: h('div', 'ff-skip'),
          list: h('ol', 'ff-moments'),
          key: h('ul', 'ff-key'),
          items: [],
          chips: this.#labels().map((label) => chip(label, () => this.show(label), false)),
          tog: chip('Show the code', () => this.toggleAttribute('code'), this.hasAttribute('code')),
          more: button('Moments', () => {
            const on = g.list.classList.toggle('ff-open');
            g.more.setAttribute('aria-expanded', String(on));
          }),
          stage: h('div', 'ff-stage'),
          ready,
          step: '',
          last: -1,
          lastStep: '',
          drawn: '',
        };
        g.ht.hidden = !this.#title;
        g.tog.className = 'ff-btn ff-chip ff-tog';
        g.more.className = 'ff-btn ff-b ff-more';
        g.more.setAttribute('aria-expanded', 'false');
        const full = button('Full screen', () => void this.requestFullscreen?.());
        full.className = 'ff-btn ff-b';
        g.key.hidden = true;
        if (ready) {
          g.stage.dataset.stage = 'world';
          const load = ++this.#worldLoads;
          import('./world.ts')
            .then((w) => {
              if (load !== this.#worldLoads || this.#g !== g) return;
              const scene = w.scene(spec);
              g.key.replaceChildren(
                ...scene.keys.map((k) => {
                  const li = h('li', '', KEYS[k]);
                  li.dataset.k = k;
                  return li;
                }),
              );
              this.#world = w.mountWorld(g.stage, scene, () => {
                const m = this.#all[this.#at];
                if (this.#g !== g || !m) return;
                g.drawn = '';
                this.#guide(g, m);
              });
              g.drawn = '';
              this.#update();
            })
            .catch((e) => this.#fault(`${this.#name}: ${(e as Error).message}`));
        } else {
          g.stage.dataset.stage = 'diagram';
          g.stage.append(pane(spec));
          g.diagram = g.stage;
        }
        const guide = h(
          'div',
          'ff-guide',
          g.stage,
          h('div', 'ff-chips', ...g.chips),
          h(
            'section',
            'ff-hud',
            g.ht,
            g.kick,
            g.say,
            g.note,
            g.code,
            g.skip,
            g.list,
            h('div', 'ff-ctl', this.#ctl.back, this.#ctl.play, this.#ctl.next, g.more, g.tog, full),
            g.key,
          ),
        );
        guide.addEventListener('click', (e) => {
          if (e.composedPath()[0] !== this.#ctl.play) this.pause();
        });
        this.#g = g;
        this.#view.append(guide);
      }
      if (form !== this.#shown) {
        this.pause();
        this.#shown = form;
        this.dispatchEvent(new CustomEvent('flowfig-form', { detail: { form }, bubbles: true, composed: true }));
      }
      this.#update();
      if (reset) this.#emit();
    } catch (e) {
      this.#fault(`${this.#name}: ${(e as Error).message}`);
    }
  }

  #update() {
    const m = this.#all[this.#at];
    this.#live.textContent = !m ? '' : this.#g ? [m.say, m.note].filter(Boolean).join(' ') : this.#svg ? m.step : '';
    if (!this.#sides) for (const t of this.#tabs) t.setAttribute('aria-pressed', String(t.textContent === m?.step));
    if (this.#ctl.back) {
      this.#ctl.back.disabled = this.#at === 0;
      this.#ctl.next.disabled = this.#at >= this.#all.length - 1;
      this.#ctl.play.textContent = this.#timer ? 'Pause' : 'Play';
    }
    if (this.#g && m) this.#guide(this.#g, m);
    if (!m || m.step === this.#seeked || !(this.#svg || this.#sides)) return;
    this.#seeked = m.step;
    if (!this.#svg) this.#run(m.step);
    else if (still()) seek(this.#svg, endOf(this.#spec!, m.step));
    else seek(this.#svg, clock(this.#spec!, m.step)[0], true);
  }

  #guide(g: Guide, m: Spot) {
    const mine = this.#all.filter((s) => s.step === m.step);
    const first = this.#all.indexOf(mine[0]);
    const k = this.#at - first;
    const end = !!m.summary;
    const asked = mine
      .slice(0, k + 1)
      .reverse()
      .find((s) => s.stamp);
    const stamp = asked?.stamp;
    g.kick.textContent = `${end ? 'Summary' : `Moment ${k + 1} of ${mine.length - 1}`} · ${m.step}`;
    g.say.textContent = m.say;
    g.note.textContent = m.note;
    g.note.classList.toggle('ff-bad', stamp?.mark === '✗' && (end || m.stamp === stamp));
    g.code.hidden = end || !this.hasAttribute('code');
    g.code.textContent = m.code.length ? m.code.join('\n') : 'No source in the spec.';
    for (const c of g.chips) c.setAttribute('aria-pressed', String(c.textContent === m.step));
    const skipped = m.summary?.notReached ?? [];
    g.skip.hidden = !skipped.length;
    g.skip.replaceChildren(
      ...(skipped.length ? [h('p', 'ff-lbl', 'Skipped, because of the refusal'), h('ul', '', ...skipped.map((t) => h('li', '', t)))] : []),
    );
    if (g.step !== m.step) {
      g.step = m.step;
      g.items = mine.map((x, i) => {
        const b = button('', () => (this.moment = first + i));
        b.className = '';
        b.append(h('span', 'ff-mk', x.stamp?.mark ?? String(i + 1)), h('span', '', x.title));
        if (x.stamp?.mark === '✗') {
          b.classList.add('ff-fail');
          b.setAttribute('aria-label', `${x.title}, failed`);
        }
        return b;
      });
      g.list.replaceChildren(...g.items.map((b) => h('li', '', b)));
    }
    g.items.forEach((b, i) => {
      if (i === k) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    this.#stage(g, m, k);
  }

  #stage(g: Guide, m: Spot, k: number) {
    const world = this.#world;
    if (g.ready && !world) return;
    const key = `${world ? 'w' : 'd'}/${this.#at}`;
    if (g.drawn === key) return;
    const motion = !still() && g.lastStep === m.step && g.last === this.#at - 1;
    [g.drawn, g.last, g.lastStep] = [key, this.#at, m.step];
    clearTimeout(this.#seekTimer);
    const story = this.#labels().indexOf(m.step);
    if (world?.fits(story)) {
      if (g.diagram) g.diagram.hidden = true;
      g.key.hidden = false;
      this.#motion = world.show(story, k, motion, m.say);
      return;
    }
    this.#motion = 0;
    g.key.hidden = true;
    if (!g.diagram) {
      g.diagram = h('div', 'ff-stage', pane(this.#spec!));
      g.diagram.dataset.stage = 'diagram';
      g.stage.after(g.diagram);
    }
    g.diagram.hidden = false;
    const svg = g.diagram.querySelector('svg')!;
    const spec = this.#spec!;
    const beats = (spec.steps?.find((x) => str(x.label) === m.step)?.flow ?? []).map(toBeat);
    if (m.summary || k >= beats.length) return seek(svg, endOf(spec, m.step));
    const start = clock(spec, m.step)[0] + beats.slice(0, k).reduce((a, b) => a + beatMs(b, spec.speed ?? 900), 0);
    const end = start + beatMs(beats[k], spec.speed ?? 900);
    if (still()) return seek(svg, end);
    seek(svg, start, true);
    this.#seekTimer = setTimeout(() => seek(svg, end), (end - start) / BASE_RATE);
  }

  #emit() {
    const m = this.#all[this.#at];
    this.dispatchEvent(
      new CustomEvent('flowfig-moment', {
        detail: { step: m?.step ?? '', moment: this.#at, total: this.#all.length },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'flowfig-explain': FlowfigExplain;
  }
}

if (globalThis.customElements && !customElements.get('flowfig-explain')) customElements.define('flowfig-explain', FlowfigExplain);
