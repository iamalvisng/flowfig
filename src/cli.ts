#!/usr/bin/env node
/**
 * Render a figure as one animated SVG — for a README, a PR, an issue, a blog post — and check it first.
 *
 *   flowfig - out.svg < spec.json        # a spec on stdin: nothing is left on disk
 *   flowfig spec.json out.svg            # a spec file
 *   flowfig figure.ts out.svg            # a module whose default export is a spec
 *   flowfig --spec out.svg               # print back the spec the SVG carries
 *   flowfig check <input> [--json]       # list the faults; the input can also be an SVG this wrote
 *   flowfig verify <input>... [--root dir]   # check that the code each figure links to still exists
 *   flowfig diff <old> <new> [--json|--md]   # list the spec changes between two figures
 *   flowfig docs                         # print the full guide (Markdown)
 *   flowfig mcp                          # serve check, render, verify, diff and docs over MCP (stdio)
 *   flowfig init [dir]                   # write flowfig instructions for the coding agents of a repo
 *   flowfig draw "<question>" [--out out.svg]   # ask Claude Code for a figure, then check it
 *   flowfig open figure.svg              # show the figure in the default browser
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
import { runDraw } from './draw.ts';
import { runInit } from './init.ts';
import { serve } from './mcp.ts';
import { runOpen } from './open.ts';
import { diff, formatDiff } from './diff.ts';
import { loadSpec, reportLines, sortFindings, specOf, svgWithSpec } from './load.ts';
import type { FlowProps } from './model.ts';
import { check, type Finding } from './svg.ts';
import { links, verify, type Link } from './verify.ts';

const USAGE = `usage: flowfig <-|spec.json|figure.ts> [out.svg]   render a figure; a spec on stdin with -
       flowfig check <-|spec.json|figure.ts|figure.svg>   list the faults; the input can be an SVG this wrote
       flowfig --spec figure.svg                          print the spec the SVG carries
       flowfig verify <input>... [--root <dir>] [--json] [--strict]   check the code links of one or more figures
       flowfig diff <old> <new> [--json|--md]   list the spec changes between two figures
       flowfig docs                                       print the guide (Markdown)
       flowfig mcp                                        serve check, render, verify, diff and docs over MCP (stdio)
       flowfig init [dir] [--agents <ids>] [-y] [--global] [--dry-run] [--no-mcp]   write flowfig instructions for the coding agents of a repo
       flowfig draw "<question>" [--out <path>] [--model <alias>] [--max-turns <n>] [--json]   ask Claude Code for a figure, then check it
       flowfig open <figure.svg> [--html <path>]          show the figure in the default browser
flags for render and check: --strict (warnings are errors), --json, --width <px>, --min-text <px>, --no-check (render only)`;
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

if (!args[0] || ['help', '--help', '-h'].includes(args[0])) {
  if (args[0]) console.log(USAGE);
  else usage(USAGE);
  process.exit(0);
}

if (args[0] === 'docs') {
  process.stdout.write(GUIDE);
  process.exit(0);
}

if (args[0] === 'mcp') {
  await serve(process.stdin, process.stdout);
  // A pipe write is asynchronous: wait until the queued response lines are out before the exit.
  await new Promise((done) => process.stdout.write('', () => done(undefined)));
  process.exit(0);
}

if (args[0] === 'init') process.exit(await runInit(args.slice(1)));
if (args[0] === 'draw') process.exit(await runDraw(args.slice(1)));
if (args[0] === 'open') process.exit(await runOpen(args.slice(1)));

if (args[0] === '--spec') {
  if (!args[1]) usage('--spec needs the path of an SVG');
  let svg = '';
  try {
    svg = readFileSync(args[1], 'utf8');
  } catch (e) {
    usage(`${args[1]}: ${(e as Error).message}`);
  }
  try {
    console.log(specOf(svg, args[1]));
  } catch (e) {
    usage((e as Error).message);
  }
  process.exit(0);
}

/** A spec from stdin, a JSON file, an SVG this wrote, or a module. Exit 2 with a message on any failure. */
async function load(input: string): Promise<FlowProps> {
  try {
    if (input.endsWith('.json') || input.endsWith('.svg')) return loadSpec(input);
    if (input === '-') return loadSpec(JSON.parse(readFileSync(0, 'utf8')), input);
    return loadSpec((await import(pathToFileURL(resolve(input)).href)).default, input);
  } catch (e) {
    const m = (e as Error).message;
    return usage(m.startsWith(`${input}: `) ? m : `${input}: ${m}`);
  }
}

if (args[0] === 'verify') {
  args.shift();
  const json = flag('--json'),
    strict = flag('--strict');
  const at = args.indexOf('--root');
  const root = at === -1 ? process.cwd() : (args.splice(at, 2)[1] ?? usage('--root needs a folder'));
  const unknown = args.find((a) => a.startsWith('-') && a !== '-');
  if (unknown) usage(`unknown flag ${unknown}`);
  if (!args.length) usage('verify needs at least one figure');
  const findings: (Finding & { figure: string })[] = [];
  const all: (Link & { figure: string })[] = [];
  for (const input of args) {
    const props = await load(input);
    const found = sortFindings([...check(props), ...verify(props, { root })], strict).map((f) => ({ ...f, figure: input }));
    findings.push(...found);
    all.push(...links(props).map((l) => ({ ...l, figure: input })));
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  if (json) console.log(JSON.stringify({ findings, links: all }, null, 2));
  else {
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
    for (const f of findings) console.log(`${f.severity.padEnd(8)} ${f.rule.padEnd(18)} ${f.figure}: ${f.message}`);
    console.log(`${n(errors, 'error')}, ${n(findings.length - errors, 'warning')}`);
  }
  process.exit(errors ? 1 : 0);
}

if (args[0] === 'diff') {
  args.shift();
  const json = flag('--json'),
    md = flag('--md');
  const unknown = args.find((a) => a.startsWith('-') && a !== '-');
  if (unknown) usage(`unknown flag ${unknown}`);
  if (args.length !== 2) usage('diff needs two figures: flowfig diff <old> <new> [--json|--md]');
  const changes = diff(await load(args[0]), await load(args[1]));
  console.log(json ? JSON.stringify(changes, null, 2) : formatDiff(changes, md ? 'md' : 'text'));
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

const props = await load(input);

const findings: Finding[] = skip ? [] : sortFindings(check(props, opts), strict);
const errors = findings.filter((f) => f.severity === 'error').length;

/** The findings for a person: one line each, colored only on a terminal, then the counts. A render prints them to stderr, next to
 * its own output. A clean render still prints `0 errors, 0 warnings`: the agent copies that line into its reply. */
const report = (print: (s: string) => void, tty: boolean | undefined) => {
  // The severity field is 8 characters wide, so the painted field keeps the same width.
  const paint = (s: string) =>
    tty && !process.env.NO_COLOR ? s.replace(/^(error {3}|warning )/, (w) => `\x1b[${w[0] === 'e' ? 31 : 33}m${w}\x1b[0m`) : s;
  for (const line of reportLines(props, findings, !skip)) print(paint(line));
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
const withSpec = svgWithSpec(props);
writeFileSync(dest, withSpec);
console.log(`${dest} — ${(withSpec.length / 1024).toFixed(1)} kB`);
