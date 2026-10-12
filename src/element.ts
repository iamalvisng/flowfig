import { render } from './svg.ts';
import { BASE_RATE, DARK, LIGHT, STEP_HOLD_MS, beatMs, edgeId, nodes, str, toBeat, type FlowProps } from './model.ts';
import { cast, moments, type Moment } from './explain.ts';
import { ART, PIC_CSS, TOKENS } from './looks.ts';

type Form = 'diagram' | 'guide' | 'change';
type Spot = Moment & { step: string; ms: number; code: string[] };
type El = HTMLElement;
type Guide = {
  kick: El;
  say: El;
  note: El;
  code: El;
  stage: El;
  figs: El[];
  names: string[];
  count?: El;
  card: El;
  paper: El;
  dn: El;
  num: El;
  stamp?: El;
  pill?: El;
  recs?: El;
  sum: El;
  prog: El;
  dots: HTMLButtonElement[];
  chips: HTMLButtonElement[];
  at: number;
  step: string;
  x: number;
  tog: HTMLButtonElement;
};

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
  '.ff-live{margin:0;min-height:1.5em}',
  '.ff-alert{margin:0;color:var(--flowfig-bad)}',
  '.ff-g{position:relative;box-sizing:border-box;width:100%;height:100%;aspect-ratio:16/10;min-height:520px;display:flex;flex-direction:column;gap:0;padding:0;overflow:hidden}',
  '.ff-g>.ff-title{margin:16px 3% 0}',
  '.ff-g>.ff-row{padding:12px 3% 0}',
  '.ff-row:empty{display:none}',
  '.ff-g>.ff-view{flex:1;min-height:0;container-type:size}',
  '.ff-g>.ff-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}',
  '.ff-guide{height:100%;display:grid;grid-template-rows:minmax(19cqh,auto) minmax(0,1fr) minmax(23cqh,auto)}',
  '.ff-top{display:flex;gap:20px;align-items:flex-start;padding:2.6cqh 3cqw 0}',
  '.ff-text{flex:1;min-width:0}',
  '.ff-kick{font-size:13px;color:var(--flowfig-muted)}',
  '.ff-say{margin:6px 0 0;font-size:clamp(19px,2.4cqw,30px);line-height:1.22;font-weight:650;letter-spacing:-.01em}',
  '.ff-note{margin:8px 0 0;font-size:clamp(15px,1.6cqw,20px);line-height:1.35;color:var(--flowfig-muted)}',
  '.ff-note.ff-bad{color:var(--flowfig-bad)}',
  '.ff-code{flex:0 0 34%;box-sizing:border-box;max-height:17cqh;overflow:auto;margin:0;padding:8px 12px;font:13px/1.45 ui-monospace,Menlo,monospace;white-space:pre;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:10px}',
  '.ff-stage{--top:195px;position:relative;overflow:auto hidden;scroll-behavior:smooth;container:ff-stage/size}',
  '.ff-track{position:relative;height:100%;width:max(100%,calc(var(--n) * 132px));container-type:inline-size}',
  '.ff-cast{position:absolute;left:2cqw;right:2cqw;bottom:1.5cqh;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);align-items:end}',
  '.ff-c{display:flex;flex-direction:column;align-items:center;gap:8px}',
  '.ff-fig{position:relative;box-sizing:border-box;width:max(124px,min(90%,(100cqh - var(--top)) * 1.25));aspect-ratio:5/4;padding:10px 12px 4px;background:var(--flowfig-surface);border:1px solid var(--flowfig-border);border-radius:20px;opacity:.42;filter:saturate(.55);transition:transform .3s,opacity .3s,filter .3s,box-shadow .3s}',
  '.ff-fig svg{display:block;width:100%;height:100%;overflow:visible}',
  '.ff-fig[aria-current=true],.ff-fig.ff-on{opacity:1;filter:none}',
  '.ff-fig[aria-current=true]{transform:translateY(-10px);border-color:var(--flowfig-accent);box-shadow:0 0 0 3px var(--flowfig-accent),0 8px 12px var(--flowfig-pic-sh)}',
  '.ff-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:600;color:var(--flowfig-muted)}',
  '[aria-current=true]+.ff-name{color:var(--flowfig-accent)}',
  '.ff-count{display:inline-block;margin-left:6px;min-width:22px;padding:0 6px;box-sizing:border-box;font-size:13px;line-height:22px;text-align:center;border-radius:999px;background:var(--flowfig-ink);color:var(--flowfig-bg)}',
  '.ff-card{position:absolute;top:22px;left:50%;z-index:2;transform:translateX(-50%);transition:left .5s cubic-bezier(.45,0,.2,1)}',
  '.ff-paper{position:relative;box-sizing:border-box;width:150px;padding:10px 14px 12px;display:flex;flex-direction:column;gap:5px;background:var(--flowfig-paper);color:var(--flowfig-paper-ink);border-radius:6px 18px 6px 6px;box-shadow:0 4px 12px var(--flowfig-pic-sh),0 0 0 1px #0000000f}',
  '.ff-dn{padding-right:22px;font-size:13px;font-weight:600;line-height:1.3}',
  '.ff-paper b{font-size:26px;line-height:1;font-weight:750}',
  '.ff-paper i{height:5px;border-radius:3px;background:#e3e7ee}',
  '.ff-paper i+i{width:60%}',
  '.ff-st{position:absolute;top:-18px;right:-30px;width:52px;height:52px;display:grid;place-items:center;border-radius:50%;font-size:28px;font-weight:700;background:var(--flowfig-ink);color:var(--flowfig-bg);box-shadow:0 0 0 3px var(--flowfig-bg);transform:rotate(-8deg);animation:ff-stamp .35s .15s cubic-bezier(.2,1.3,.4,1) backwards}',
  '.ff-pill{position:absolute;left:50%;bottom:0;transform:translate(-50%,50%);padding:4px 12px;font-size:15px;font-weight:600;white-space:nowrap;border-radius:999px;background:var(--flowfig-ink);color:var(--flowfig-bg);animation:ff-fade .3s .3s backwards}',
  '.ff-st.ff-x,.ff-pill.ff-x{background:var(--flowfig-bad)}',
  '.ff-still{animation:none}',
  '@keyframes ff-stamp{from{opacity:0;transform:scale(1.8) rotate(-18deg)}}',
  '@keyframes ff-fade{from{opacity:0}}',
  '.ff-recs{position:absolute;left:50%;top:12%;z-index:1;display:flex;flex-direction:column;align-items:center;gap:4px;transform:translateX(-50%)}',
  '.ff-rec{padding:3px 8px;font-size:13px;font-weight:600;white-space:nowrap;background:var(--flowfig-paper);color:var(--flowfig-paper-ink);border:1px solid var(--flowfig-border);border-radius:5px;box-shadow:0 2px 6px var(--flowfig-pic-sh);animation:ff-fly .5s cubic-bezier(.45,0,.2,1) backwards}',
  '@keyframes ff-fly{from{opacity:0;transform:translate(var(--dx),-24cqh)}}',
  '@container ff-stage (height < 320px){.ff-track{--top:140px}.ff-card{top:16px}.ff-paper{padding:6px 10px 10px}.ff-paper i{display:none}.ff-dn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ff-paper b{font-size:20px}.ff-st{top:-12px;right:-22px;width:40px;height:40px;font-size:22px}}',
  '.ff-end .ff-cast{visibility:hidden}',
  '.ff-end .ff-card{left:calc(3cqw + 75px)!important;top:50%;transform:translate(-50%,-50%)}',
  '.ff-sum{position:absolute;inset:0 3cqw 2cqh calc(3cqw + 200px);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3cqw;align-items:center}',
  '.ff-one{padding:18px 20px;background:color-mix(in srgb,var(--flowfig-accent) 8%,var(--flowfig-surface));border:1px solid var(--flowfig-accent);border-radius:14px}',
  '.ff-lbl{margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--flowfig-muted)}',
  '.ff-one p+p{margin:8px 0 0;font-size:clamp(17px,1.9cqw,24px);line-height:1.35;font-weight:600}',
  '.ff-nr{max-height:100%;overflow:auto}',
  '.ff-nr ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}',
  '.ff-nr li{padding:4px 12px;font-size:14px;color:var(--flowfig-muted);border:1px dashed var(--flowfig-muted);border-radius:999px}',
  '.ff-bot{display:flex;flex-direction:column;justify-content:space-between;gap:8px;padding:1.4cqh 3cqw;border-top:1px solid var(--flowfig-border);background:color-mix(in srgb,var(--flowfig-surface) 55%,var(--flowfig-bg))}',
  '.ff-prog{display:flex;gap:18px;align-items:flex-end}',
  '.ff-pc{display:flex;flex-direction:column;gap:4px;min-width:0;flex:var(--c) 1 0}',
  '.ff-pc:last-child{flex:none}',
  '.ff-pl{height:20px;font-size:13px;font-weight:600;color:var(--flowfig-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.ff-dots{position:relative;display:flex;justify-content:space-around;align-items:center;height:24px}',
  '.ff-dots::before{content:"";position:absolute;left:0;right:0;top:11px;height:2px;background:var(--flowfig-border)}',
  '.ff-pc:last-child .ff-dots::before{display:none}',
  '.ff-d{position:relative;width:16px;height:16px;padding:0;border:2px solid var(--flowfig-muted);border-radius:50%;transition:transform .2s}',
  '.ff-d.ff-past{background:var(--flowfig-muted)}',
  '.ff-sp{position:relative;padding:1px 10px;font-weight:600}',
  '.ff-d[aria-current=true],.ff-sp[aria-current=true]{background:var(--flowfig-accent);border-color:var(--flowfig-accent);color:var(--flowfig-on-accent)}',
  '.ff-d[aria-current=true]{transform:scale(1.35)}',
  '.ff-what{display:flex;gap:10px;align-items:center}',
  '.ff-wl{font-size:14px;font-weight:600;white-space:nowrap}',
  '.ff-chips{flex:1;display:flex;flex-wrap:wrap;gap:6px}',
  '.ff-chip{font-size:14px}',
  '.ff-chip[aria-pressed=true]{background:var(--flowfig-ink);border-color:var(--flowfig-ink);color:var(--flowfig-bg)}',
  '.ff-ctl{display:flex;gap:8px;justify-content:center}',
  '.ff-b{min-width:104px;padding:6px 16px;font-size:15px;font-weight:600;border-radius:10px}',
  '.ff-next{background:var(--flowfig-accent);border-color:var(--flowfig-accent);color:var(--flowfig-on-accent)}',
  '.ff-back::before{content:"\\2190  "/""}',
  '.ff-next::after{content:"  \\2192"/""}',
  '@container ff-host (width < 900px){.ff-g{aspect-ratio:auto;height:auto}.ff-g>.ff-view{flex:none;container-type:inline-size}.ff-guide{height:auto;grid-template-rows:auto 300px auto}.ff-top{padding:16px 3cqw 0}.ff-bot{padding:10px 3cqw}}',
  '@media (prefers-reduced-motion:reduce){.ff-guide *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}',
  PIC_CSS,
].join('\n');

let sheet: CSSStyleSheet | undefined;

const PLAIN =
  '<ellipse class="ff-sh" cx="100" cy="151" rx="56" ry="6"/><rect class="ff-b2" x="48" y="28" width="104" height="120" rx="14"/><rect class="ff-b3" x="62" y="42" width="76" height="92" rx="8"/>';

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
  #g?: Guide;
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
  }

  disconnectedCallback() {
    this.pause();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src' || name === 'before') void this.#load();
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
        const edges = new Map(spec.edges.map((e) => [edgeId(e), e]));
        const boxes = new Map(nodes(spec.layout).map((n) => [n.id, n]));
        this.#all = (spec.steps ?? []).flatMap((s) => {
          const label = str(s.label);
          const beats = s.flow.map(toBeat);
          return moments(spec, label).map((m, k) => {
            const hops = beats[k]?.hops ?? [];
            const code = hops.flatMap((hp) => {
              const e = edges.get(hp.edge);
              return [hp.source, hp.via, e?.source, e?.via, boxes.get(e?.from ?? '')?.source, boxes.get(e?.to ?? '')?.source];
            });
            return {
              ...m,
              step: label,
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
      const form = asked && FORMS.includes(asked) ? asked : forms.includes('guide') ? 'guide' : (forms[0] ?? 'diagram');

      this.#forms.replaceChildren(...(forms.length > 1 ? forms.map((f) => button(f, () => this.setAttribute('form', f), f === form)) : []));
      this.#heading.textContent = this.#title;
      this.#heading.hidden = !this.#title;
      this.#svg = undefined;
      this.#g = undefined;
      this.#root.classList.toggle('ff-g', form === 'guide');
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
        this.#ctl.back.className = 'ff-btn ff-b ff-back';
        this.#ctl.play.className = 'ff-btn ff-b';
        this.#ctl.next.className = 'ff-btn ff-b ff-next';
        const actors = cast(spec);
        const figs = actors.map((a) => {
          const fig = h('div', 'ff-fig');
          fig.dataset.actor = a.name;
          fig.innerHTML = `<svg viewBox="0 0 200 160" aria-hidden="true">${a.look && Object.hasOwn(ART, a.look) ? ART[a.look] : PLAIN}</svg>`;
          return fig;
        });
        const names = actors.map((a) => a.name);
        const count = names.includes('Records') ? h('span', 'ff-count') : undefined;
        const paper = h('div', 'ff-paper', h('span', 'ff-dn'), h('b', ''), h('i', ''), h('i', ''));
        const chip = (label: string, onClick: () => void, pressed: boolean) => {
          const b = button(label, onClick, pressed);
          b.className = 'ff-btn ff-chip';
          return b;
        };
        const g: Guide = {
          kick: h('div', 'ff-kick'),
          say: h('h3', 'ff-say'),
          note: h('p', 'ff-note'),
          code: h('pre', 'ff-code'),
          stage: h('div', 'ff-stage'),
          figs,
          names,
          count,
          card: h('div', 'ff-card', paper),
          paper,
          dn: paper.children[0] as El,
          num: paper.children[1] as El,
          sum: h('div', 'ff-sum'),
          prog: h('div', 'ff-prog'),
          dots: [],
          chips: this.#labels().map((label) => chip(label, () => this.show(label), false)),
          tog: chip('Show the code', () => this.toggleAttribute('code'), this.hasAttribute('code')),
          at: -1,
          step: '',
          x: -1,
        };
        const track = h(
          'div',
          'ff-track',
          h(
            'div',
            'ff-cast',
            ...actors.map((a, i) =>
              h('div', 'ff-c', figs[i], h('div', 'ff-name', a.name, ...(a.name === 'Records' && count ? [count] : []))),
            ),
          ),
          g.card,
        );
        track.style.setProperty('--n', String(actors.length));
        g.stage.append(track, g.sum);
        const guide = h(
          'div',
          'ff-guide',
          h('div', 'ff-top', h('div', 'ff-text', g.kick, g.say, g.note), g.code),
          g.stage,
          h(
            'div',
            'ff-bot',
            g.prog,
            h('div', 'ff-what', h('span', 'ff-wl', 'What if…'), h('div', 'ff-chips', ...g.chips), g.tog),
            h('div', 'ff-ctl', this.#ctl.back, this.#ctl.play, this.#ctl.next),
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
    this.#live.textContent = m ? [m.say, m.note].filter(Boolean).join(' ') : '';
    for (const t of this.#tabs) t.setAttribute('aria-pressed', String(t.textContent === m?.step));
    if (this.#ctl.back) {
      this.#ctl.back.disabled = this.#at === 0;
      this.#ctl.next.disabled = this.#at >= this.#all.length - 1;
      this.#ctl.play.textContent = this.#timer ? 'Pause' : 'Play';
    }
    if (this.#g && m) this.#guide(this.#g, m);
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

  #guide(g: Guide, m: Spot) {
    const mine = this.#all.filter((s) => s.step === m.step);
    const first = this.#all.indexOf(mine[0]);
    const k = this.#at - first;
    const end = !!m.summary;
    const stamp = mine
      .slice(0, k + 1)
      .reverse()
      .find((s) => s.stamp)?.stamp;
    g.kick.textContent = `${end ? 'Summary' : `Moment ${k + 1} of ${mine.length - 1}`} · ${m.step}`;
    g.say.textContent = m.say;
    g.note.textContent = m.note;
    g.note.classList.toggle('ff-bad', stamp?.mark === '✗' && (end || m.stamp === stamp));
    g.code.hidden = end || !this.hasAttribute('code');
    g.code.textContent = m.code.length ? m.code.join('\n') : 'No source in the spec.';
    for (const c of g.chips) c.setAttribute('aria-pressed', String(c.textContent === m.step));
    if (g.at === this.#at) return;
    g.at = this.#at;

    if (g.step !== m.step) {
      g.step = m.step;
      const runs: number[][] = [];
      for (let i = 0; i < mine.length - 1; i++) {
        if (i && mine[i].actor === mine[i - 1].actor) runs.at(-1)!.push(first + i);
        else runs.push([first + i]);
      }
      const go = (i: number, name: string, cls: string, label?: string) => {
        const b = button(name, () => (this.moment = i));
        b.className = cls;
        if (label) b.setAttribute('aria-label', label);
        return b;
      };
      g.dots = runs.flatMap((run) => run.map((i) => go(i, '', 'ff-d', `Moment ${i - first + 1} of ${mine.length - 1}`)));
      g.dots.push(go(first + mine.length - 1, 'Summary', 'ff-btn ff-sp'));
      let d = 0;
      const pc = (label: string, n: number) => {
        const col = h('div', 'ff-pc', h('span', 'ff-pl', label), h('div', 'ff-dots', ...g.dots.slice(d, (d += n))));
        col.style.setProperty('--c', String(n));
        return col;
      };
      g.prog.replaceChildren(...runs.map((run) => pc(mine[run[0] - first].actor, run.length)), pc('', 1));
    }
    g.dots.forEach((d, i) => {
      const at = first + i;
      d.classList.toggle('ff-past', at < this.#at);
      if (at === this.#at) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });

    const n = g.names.length;
    const i = g.names.indexOf(m.actor);
    const rec = g.names.indexOf('Records');
    const from = g.x;
    g.figs.forEach((f, j) => {
      if (j === i && !end) f.setAttribute('aria-current', 'true');
      else f.removeAttribute('aria-current');
      f.classList.toggle('ff-on', j === rec && m.records.length > 0);
    });
    if (i >= 0) {
      g.x = i;
      g.card.style.left = `clamp(83px, ${2 + (96 * (i + 0.5)) / n}cqw, calc(100cqw - 113px))`;
    }
    g.stage.scrollLeft = end ? 0 : (g.stage.scrollWidth * (2 + (96 * (g.x + 0.5)) / n)) / 100 - g.stage.clientWidth / 2;
    g.dn.textContent = m.step;
    g.num.textContent = `#${this.#labels().indexOf(m.step) + 1}`;
    g.stamp?.remove();
    g.pill?.remove();
    g.stamp = g.pill = undefined;
    if (stamp) {
      const cls = `${stamp.mark === '✗' ? ' ff-x' : ''}${m.stamp === stamp ? '' : ' ff-still'}`;
      g.stamp = h('span', `ff-st${cls}`, stamp.mark);
      g.paper.append(g.stamp);
      if (stamp.label) g.card.append((g.pill = h('span', `ff-pill${cls}`, stamp.label)));
    }
    g.recs?.remove();
    g.recs = undefined;
    if (rec >= 0 && m.records.length) {
      g.recs = h('div', 'ff-recs', ...m.records.map((r) => h('span', 'ff-rec', r)));
      g.recs.style.setProperty('--dx', `${(96 * ((from < 0 ? rec : from) - rec)) / n}cqw`);
      g.figs[rec].append(g.recs);
    }
    if (g.count) {
      const filed = mine.slice(0, k + 1).reduce((a, s) => a + s.records.length, 0);
      g.count.textContent = String(filed);
      g.count.hidden = !filed;
    }
    g.stage.classList.toggle('ff-end', end);
    g.sum.replaceChildren();
    if (m.summary) {
      g.sum.append(
        h('div', 'ff-one', h('p', 'ff-lbl', 'Outcome'), h('p', '', m.summary.outcome)),
        h(
          'div',
          'ff-nr',
          h('p', 'ff-lbl', 'not reached'),
          h('ul', '', ...(m.summary.notReached.length ? m.summary.notReached : ['none']).map((t) => h('li', '', t))),
        ),
      );
    }
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
