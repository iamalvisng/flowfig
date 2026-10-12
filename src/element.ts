import { render } from './svg.ts';
import { BASE_RATE, DARK, LIGHT, STEP_HOLD_MS, beatMs, str, toBeat, type FlowProps } from './model.ts';
import { moments, type Moment } from './explain.ts';
import { PIC_CSS, TOKENS } from './looks.ts';

type Form = 'diagram' | 'guide' | 'change';
type Spot = Moment & { step: string; ms: number };

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
  `:host{display:block;${tokens(TOKENS.light)}}`,
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
  '.ff-live{margin:0;min-height:1.5em}',
  '.ff-alert{margin:0;color:var(--flowfig-bad)}',
  PIC_CSS,
].join('\n');

let sheet: CSSStyleSheet | undefined;

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
  #loads = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #shown?: Form;
  #seeked?: string;
  #svg?: SVGSVGElement;
  #tabs: HTMLButtonElement[] = [];
  #ctl: Record<string, HTMLButtonElement> = {};
  #heading = h('h2', 'ff-title');
  #forms = h('div', 'ff-row');
  #view = h('div', 'ff-view');
  #live = h('p', 'ff-live');

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
    root.append(h('div', 'ff-root', title, this.#forms, this.#view, this.#live, caption));
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
  }

  disconnectedCallback() {
    this.pause();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src' || name === 'before') void this.#load();
    else if (name === 'step') {
      if (value) this.show(value);
    } else if (name !== 'theme') this.#draw();
  }

  get spec() {
    return this.#spec;
  }
  set spec(v: FlowProps | undefined) {
    this.#loads++;
    this.#spec = v;
    this.#title = '';
    this.#name = 'spec';
    this.#draw(true);
  }

  get beforeSpec() {
    return this.#before;
  }
  set beforeSpec(v: FlowProps | undefined) {
    this.#loads++;
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
      }, this.#all[this.#at].ms);
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
    return (this.#spec?.steps ?? []).map((s) => str(s.label));
  }

  #stepBy(d: number) {
    const labels = this.#labels();
    const i = labels.indexOf(this.#all[this.#at]?.step ?? '');
    const next = labels[Math.min(Math.max(0, i + d), labels.length - 1)];
    if (next !== undefined) this.show(next);
  }

  #key = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
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
      if (label !== undefined) this.show(label);
    } else return;
    e.preventDefault();
  };

  async #load() {
    const n = ++this.#loads;
    const src = this.getAttribute('src');
    const before = this.getAttribute('before');
    try {
      const [a, b] = await Promise.all([src ? read(src) : undefined, before ? read(before) : undefined]);
      if (n !== this.#loads) return;
      if (b) this.#before = b.props;
      if (!a) return this.#draw();
      this.#spec = a.props;
      this.#title = a.title;
      this.#name = src!;
      this.#draw(true);
    } catch (e) {
      if (n === this.#loads) this.#fault((e as Error).message);
    }
  }

  #fault(message: string) {
    this.pause();
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
        this.#all = (spec.steps ?? []).flatMap((s) => {
          const label = str(s.label);
          const beats = s.flow.map(toBeat);
          return moments(spec, label).map((m, k) => ({ ...m, step: label, ms: k < beats.length ? beatMs(beats[k], speed) : STEP_HOLD_MS }));
        });
        const step = this.getAttribute('step');
        this.#at = Math.max(0, step ? this.#all.findIndex((m) => m.step === step) : 0);
      }
      const allowed = FORMS.filter((f) => (f === 'guide' ? !!spec.steps?.length : f === 'change' ? !!this.#before : true));
      const listed = this.getAttribute('forms')?.split(/\s+/);
      const forms = listed ? allowed.filter((f) => listed.includes(f)) : allowed;
      const asked = this.getAttribute('form') as Form | null;
      const form = asked && FORMS.includes(asked) ? asked : forms.includes('guide') ? 'guide' : (forms[0] ?? 'diagram');

      this.#forms.replaceChildren(...(forms.length > 1 ? forms.map((f) => button(f, () => this.setAttribute('form', f), f === form)) : []));
      this.#heading.textContent = this.#title;
      this.#heading.hidden = !this.#title;
      this.#svg = undefined;
      this.#seeked = undefined;
      this.#tabs = [];
      this.#ctl = {};
      this.#view.replaceChildren();
      if (form === 'diagram') {
        const { svg, scene } = render(spec);
        const pane = h('div', 'ff-pane');
        pane.innerHTML = svg;
        pane.style.setProperty('--ff-min', `${(scene.width * 11) / scene.minFont}px`);
        pane.style.setProperty('--ff-max', `${scene.width}px`);
        this.#svg = pane.querySelector('svg') ?? undefined;
        this.#tabs = this.#labels().map((label) => button(label, () => this.show(label), false));
        this.#view.append(pane, h('div', 'ff-row', ...this.#tabs));
      } else if (form === 'guide') {
        this.#ctl = {
          back: button('Back', () => this.back()),
          play: button('Play', () => (this.#timer ? this.pause() : this.play())),
          next: button('Next', () => this.next()),
        };
        this.#view.append(h('div', 'ff-row', this.#ctl.back, this.#ctl.play, this.#ctl.next));
      }
      if (form !== this.#shown) {
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
    this.#live.textContent = m ? [m.say, m.note].filter(Boolean).join(' ') : '';
    for (const t of this.#tabs) t.setAttribute('aria-pressed', String(t.textContent === m?.step));
    if (this.#ctl.back) {
      this.#ctl.back.disabled = this.#at === 0;
      this.#ctl.next.disabled = this.#at >= this.#all.length - 1;
      this.#ctl.play.textContent = this.#timer ? 'Pause' : 'Play';
    }
    if (!this.#svg || !m || m.step === this.#seeked) return;
    this.#seeked = m.step;
    const speed = this.#spec?.speed ?? 900;
    const earlier = (this.#spec?.steps ?? []).slice(0, this.#labels().indexOf(m.step));
    const ms = earlier.reduce(
      (sum, s) => sum + s.flow.reduce((a, b) => a + beatMs(toBeat(b), speed), 0) + (s.flow.length ? STEP_HOLD_MS : 0),
      0,
    );
    const t = ms / 1000 / BASE_RATE;
    this.#svg.setCurrentTime(t);
    for (const a of this.#svg.getAnimations({ subtree: true })) a.currentTime = t * 1000;
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
