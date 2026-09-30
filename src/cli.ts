#!/usr/bin/env node
/**
 * Render a figure as one animated SVG — for a README, a PR, an issue, a blog post — and check it first.
 *
 *   flowfig - out.svg < spec.json        # a spec on stdin: nothing is left on disk
 *   flowfig spec.json out.svg            # a spec file
 *   flowfig figure.ts out.svg            # a module whose default export is a spec
 *   flowfig --spec out.svg               # print back the spec the SVG carries
 *   flowfig check <input> [--json]       # list the faults; the input can also be an SVG this wrote
 *   flowfig docs                         # print the full guide (Markdown)
 *   flowfig init [dir]                   # write flowfig instructions for the coding agents of a repo
 *
 * A render checks first and writes nothing on an error (--no-check skips that). --strict makes warnings errors; --width and
 * --min-text set the page width and the smallest text the reader should get.
 *
 * Every rendered SVG carries its own spec in <metadata>, so a figure is editable later without anyone having to keep the JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GUIDE } from './guide.ts';
import { runInit } from './init.ts';
import { counts } from './model.ts';
import { check, toSvg, type Finding } from './svg.ts';

const USAGE = `usage: flowfig <-|spec.json|figure.ts> [out.svg]   render a figure; a spec on stdin with -
       flowfig check <-|spec.json|figure.ts|figure.svg>   list the faults; the input can be an SVG this wrote
       flowfig --spec figure.svg                          print the spec the SVG carries
       flowfig docs                                       print the guide (Markdown)
       flowfig init [dir] [--agents <ids>] [-y] [--global] [--dry-run]   write flowfig instructions for the coding agents of a repo
flags for render and check: --strict (warnings are errors), --json, --width <px>, --min-text <px>, --no-check (render only)`;
const SPEC_OPEN = '<metadata id="figure-spec"><![CDATA[';
const SPEC_CLOSE = ']]></metadata>';
/** Bad use, not a bad figure: exit 2 with a message, not a stack trace. A declaration, so TypeScript narrows after a call. */
function usage(message: string): never {
  console.error(message);
  process.exit(2);
}
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i !== -1 && args.splice(i, 1).length > 0;
};
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const n = Number(args.splice(i, 2)[1] || NaN);
  return n > 0 && Number.isFinite(n) ? n : usage(`${name} needs a positive number`);
};
function specOf(svg: string, name: string): string {
  const at = svg.indexOf(SPEC_OPEN);
  if (at === -1) usage(`${name}: no figure spec inside this SVG`);
  return svg.slice(at + SPEC_OPEN.length, svg.indexOf(SPEC_CLOSE, at));
}

if (!args[0] || ['help', '--help', '-h'].includes(args[0])) {
  if (args[0]) console.log(USAGE);
  else usage(USAGE);
  process.exit(0);
}

if (args[0] === 'docs') {
  process.stdout.write(GUIDE);
  process.exit(0);
}

if (args[0] === 'init') process.exit(await runInit(args.slice(1)));

if (args[0] === '--spec') {
  if (!args[1]) usage('--spec needs the path of an SVG');
  let svg = '';
  try {
    svg = readFileSync(args[1], 'utf8');
  } catch (e) {
    usage(`${args[1]}: ${(e as Error).message}`);
  }
  console.log(specOf(svg, args[1]));
  process.exit(0);
}

const command = args[0] === 'check' ? args.shift()! : 'render';
const json = flag('--json'),
  strict = flag('--strict'),
  skip = flag('--no-check');
const opts = { width: value('--width'), minText: value('--min-text') };
const unknown = args.find((a) => a.startsWith('-') && a !== '-');
if (unknown) usage(`unknown flag ${unknown}`);
const [input, out] = args;
if (!input) usage(USAGE);

let loaded;
try {
  loaded =
    input === '-'
      ? JSON.parse(readFileSync(0, 'utf8'))
      : input.endsWith('.json')
        ? JSON.parse(readFileSync(input, 'utf8'))
        : input.endsWith('.svg')
          ? JSON.parse(specOf(readFileSync(input, 'utf8'), input))
          : (await import(pathToFileURL(resolve(input)).href)).default;
} catch (e) {
  usage(`${input}: ${(e as Error).message}`);
}
const props = loaded?.props ?? loaded;
if (!props?.layout) usage(`${input}: no figure props (expected { props: { layout, edges, steps } })`);
if (!Array.isArray(props.edges)) usage(`${input}: edges must be an array (use [] for none)`);
if (props.steps?.some((s: { flow?: unknown }) => !Array.isArray(s?.flow))) usage(`${input}: each step needs a flow array`);

const findings: Finding[] = skip
  ? []
  : check(props, opts)
      .map((f) => (strict ? { ...f, severity: 'error' as const } : f))
      .sort((a, b) => (a.severity === b.severity ? a.rule.localeCompare(b.rule) : a.severity === 'error' ? -1 : 1));
const errors = findings.filter((f) => f.severity === 'error').length;

/** The findings for a person: one line each, colored only on a terminal, then the counts. A render prints them to stderr, next to
 * its own output. A clean render still prints `0 errors, 0 warnings`: the agent copies that line into its reply. */
const report = (print: (s: string) => void, tty: boolean | undefined) => {
  const paint = (s: string, code: number) => (tty && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
  for (const f of findings) print(`${paint(f.severity.padEnd(8), f.severity === 'error' ? 31 : 33)} ${f.rule.padEnd(18)} ${f.message}`);
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  if (!skip) print(`${n(errors, 'error')}, ${n(findings.length - errors, 'warning')}`);
  const c = counts(props);
  print(
    `figure: ${n(c.boxes, 'box').replace('boxs', 'boxes')}, ${n(c.groups, 'group')}, ${n(c.edges, 'edge')}, ${n(c.steps, 'step')}, ${n(c.messages, 'message')}`,
  );
};

if (command === 'check') {
  if (json) console.log(JSON.stringify(findings, null, 2));
  else report(console.log, process.stdout.isTTY);
  process.exit(errors ? 1 : 0);
}

report(console.error, process.stderr.isTTY);
if (errors) process.exit(1);
const dest = out ?? (input === '-' ? 'figure.svg' : input.replace(/\.[^./\\]+$/, '') + '.svg');
// The spec rides along in <metadata>: an SVG is then its own source, and no JSON has to be kept.
// `]]>` would close the CDATA early; it cannot appear in JSON-encoded text, but be sure.
const spec = JSON.stringify({ props }).replaceAll(']]>', ']]\\u003e');
const withSpec = toSvg(props).replace(/(<svg[^>]*>\n?)/, (tag) => `${tag}${SPEC_OPEN}${spec}${SPEC_CLOSE}\n`);
writeFileSync(dest, withSpec);
console.log(`${dest} — ${(withSpec.length / 1024).toFixed(1)} kB`);
