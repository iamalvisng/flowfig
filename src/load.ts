import { readFileSync } from 'node:fs';
import { counts, toBeat, type FlowProps } from './model.ts';
import { coverageLine, owners, unsureLines, verifyReport } from './verify.ts';
import { toSvg, type Finding, type SvgOptions } from './svg.ts';

const SPEC_OPEN = '<metadata id="figure-spec"><![CDATA[';
const SPEC_CLOSE = ']]></metadata>';

export function specOf(svg: string, name: string): string {
  const at = svg.indexOf(SPEC_OPEN);
  if (at === -1) throw new Error(`${name}: no figure spec inside this SVG`);
  return svg.slice(at + SPEC_OPEN.length, svg.indexOf(SPEC_CLOSE, at));
}

/** A spec from a `.json` or SVG path, or an object (`{ props }` or the props). Every error message starts with the name. */
export function loadSpec(input: string | object, name = typeof input === 'string' ? input : 'spec'): FlowProps {
  let loaded: unknown = input;
  if (typeof input === 'string') {
    if (!input.endsWith('.json') && !input.endsWith('.svg')) throw new Error(`${input}: expected a .json or .svg path`);
    try {
      const text = readFileSync(input, 'utf8');
      loaded = JSON.parse(input.endsWith('.svg') ? specOf(text, input) : text);
    } catch (e) {
      const m = (e as Error).message;
      throw new Error(m.startsWith(`${input}: `) ? m : `${input}: ${m}`);
    }
  }
  const props = ((loaded as { props?: unknown })?.props ?? loaded) as FlowProps;
  if (!props?.layout) throw new Error(`${name}: no figure props (expected { props: { layout, edges, steps } })`);
  if (!Array.isArray(props.edges)) throw new Error(`${name}: edges must be an array (use [] for none)`);
  if (props.steps?.some((s: { flow?: unknown }) => !Array.isArray(s?.flow))) throw new Error(`${name}: each step needs a flow array`);
  return props;
}

/** The SVG with its spec in `<metadata>`: an SVG is then its own source. `]]>` would close the CDATA early, so it is escaped. */
export function svgWithSpec(props: FlowProps, opts: SvgOptions = {}, svg = toSvg(props, opts)): string {
  const spec = JSON.stringify({ props }).replaceAll(']]>', ']]\\u003e');
  return svg.replace(/(<svg[^>]*>\n?)/, (tag) => `${tag}${SPEC_OPEN}${spec}${SPEC_CLOSE}\n`);
}

export function sortFindings(findings: Finding[], strict: boolean): Finding[] {
  return findings
    .map((f) => (strict ? { ...f, severity: 'error' as const } : f))
    .sort((a, b) => (a.severity === b.severity ? a.rule.localeCompare(b.rule) : a.severity === 'error' ? -1 : 1));
}

const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

/** One line per finding, the counts line (unless `withCounts` is false), and the `figure:` line. No color: the CLI adds it. */
export function reportLines(props: FlowProps, findings: Finding[], withCounts = true): string[] {
  const out = findings.map((f) => `${f.severity.padEnd(8)} ${f.rule.padEnd(18)} ${f.message}`);
  const errors = findings.filter((f) => f.severity === 'error').length;
  if (withCounts) out.push(`${n(errors, 'error')}, ${n(findings.length - errors, 'warning')}`);
  const c = counts(props);
  out.push(
    `figure: ${n(c.boxes, 'box').replace('boxs', 'boxes')}, ${n(c.groups, 'group')}, ${n(c.edges, 'edge')}, ${n(c.steps, 'step')}, ${n(c.messages, 'message')}`,
  );
  return out;
}

const text = (x: unknown) => (typeof x === 'string' ? x : '');

/** One line per edge, then one line per step with its hop count. */
export function summaryLines(props: FlowProps): string[] {
  const edges = props.edges.map((e) => {
    const label = text(e.label);
    return `${e.from} -> ${e.to}${label ? `: ${label}` : ''}`;
  });
  const steps = (props.steps ?? []).map((s) => {
    const hops = s.flow.reduce((k, b) => k + toBeat(b).hops.length, 0);
    return `step "${text(s.label)}": ${hops} ${hops === 1 ? 'hop' : 'hops'}`;
  });
  return [...edges, ...steps];
}

/** The verify lines of a render: findings, the count line and the unsure edges. Empty if no source or via. */
export function verifyLines(props: FlowProps, figure: string, root = process.cwd()): string[] {
  if (!owners(props).some(([, source, via]) => source != null || via != null)) return [];
  const { findings, coverage } = verifyReport(props, { root });
  return [
    ...findings.map((f) => `${f.severity.padEnd(8)} ${f.rule.padEnd(18)} ${figure}: ${f.message}`),
    coverageLine(figure, coverage),
    ...unsureLines(coverage),
  ];
}
