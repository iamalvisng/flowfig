#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureFrames, findBrowser, launch } from './browser.ts';
import { delays, encodeGif } from './gif.ts';
import { GUIDE } from './guide.ts';
import { runDraw } from './draw.ts';
import { runInit } from './init.ts';
import { serve } from './mcp.ts';
import { openedLine, openSvg, runOpen } from './open.ts';
import { pageHtml } from './page.ts';
import { decodePng } from './png.ts';
import { diff, formatDiff } from './diff.ts';
import { loadSpec, reportLines, sortFindings, specOf, svgWithSpec } from './load.ts';
import type { FlowProps } from './model.ts';
import { check, toSvg, type Finding } from './svg.ts';
import { links, verify, type Link } from './verify.ts';

const USAGE = `usage: flowfig <-|spec.json|figure.ts> [out.svg] [--open]   render a figure; a spec on stdin with -
       flowfig check <-|spec.json|figure.ts|figure.svg>   list the faults; the input can be an SVG this wrote
       flowfig --spec figure.svg                          print the spec the SVG carries
       flowfig verify <input>... [--root <dir>] [--json] [--strict]   check the code links of one or more figures
       flowfig diff <old> <new> [--json|--md]   list the spec changes between two figures
       flowfig docs                                       print the guide (Markdown)
       flowfig mcp                                        serve check, render, verify, diff and docs over MCP (stdio)
       flowfig init [dir] [--agents <ids>] [-y] [--global] [--dry-run] [--no-mcp]   write flowfig instructions for the coding agents of a repo
       flowfig draw "<question>" [--out <path>] [--model <alias>] [--max-turns <n>] [--json] [--open]   ask Claude Code for a figure, then check it
       flowfig open <figure.svg> [--html <path>]          show the figure in the default browser
       flowfig gif <figure.svg> [out.gif] [--step <n>] [--dark] [--fps <n>] [--scale <n>] [--mp4]   write an animated GIF
flags for render and check: --strict (warnings are errors), --json, --width <px>, --min-text <px>, --no-check (render only)`;
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
  // A pipe write is asynchronous: wait for the queued lines before the exit.
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

if (args[0] === 'gif') {
  args.shift();
  const dark = flag('--dark'),
    mp4 = flag('--mp4');
  const fps = value('--fps') ?? 20,
    scale = value('--scale') ?? 2,
    step = value('--step');
  if (!Number.isInteger(fps) || fps > 50) usage('--fps needs a whole number from 1 to 50');
  const unknown = args.find((a) => a.startsWith('-'));
  if (unknown) usage(`unknown flag ${unknown}`);
  const [path, outArg] = args;
  if (!path) usage('usage: flowfig gif <figure.svg> [out.gif] [--step <n>] [--dark] [--fps <n>] [--scale <n>] [--mp4]');
  if (!path.endsWith('.svg')) usage(`${path}: expected a .svg path`);
  let svg = '';
  try {
    svg = readFileSync(path, 'utf8');
  } catch (e) {
    usage(`${path}: ${(e as Error).message}`);
  }
  if (step !== undefined) {
    const props = (() => {
      try {
        return loadSpec(path);
      } catch (e) {
        return usage((e as Error).message);
      }
    })();
    const count = props.steps?.length ?? 0;
    if (!count) usage(`${path}: --step needs a figure with steps; this figure has 0`);
    if (!Number.isInteger(step) || step > count) usage(`--step needs a whole number from 1 to ${count}`);
    svg = toSvg({ ...props, steps: [props.steps![step - 1]] });
  }
  const out = outArg ?? path.replace(/\.svg$/, step === undefined ? '.gif' : `-step${step}.gif`);
  const size = /<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
  if (!size) usage(`${path}: no width and height on the <svg> element`);
  if (!existsSync(dirname(resolve(out)))) usage(`${out}: the folder does not exist`);
  const found = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });
  if (!found.path)
    usage(['gif needs Chrome, Edge, Chromium or Brave. Checked:', ...found.checked, 'Set CHROME_PATH to the browser program.'].join('\n'));
  const line = (file: string, frames: number, bytes: number) =>
    `${file} — ${frames} frame${frames === 1 ? '' : 's'}, ${(frames / fps).toFixed(1)} s, ${(bytes / 1048576).toFixed(1)} MB`;

  const temp = mkdtempSync(join(tmpdir(), 'flowfig-gif-'));
  let launching: ReturnType<typeof launch> | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = () =>
    (cleaning ??= (async () => {
      await (await launching?.catch(() => undefined))?.close();
      try {
        // Windows can hold a file lock briefly after the exit, so retry.
        rmSync(temp, { recursive: true, force: true, maxRetries: 10 });
      } catch (e) {
        console.error(`warning: could not remove ${temp}: ${(e as Error).message}`);
      }
    })());
  const written: string[] = [];
  let ffmpeg: ReturnType<typeof spawn> | undefined,
    ffmpegDone: Promise<unknown> = Promise.resolve(),
    stopped = 0;
  const yieldLoop = () => new Promise((done) => setImmediate(done));
  // Keep the handlers: a second signal must not end the process mid-cleanup.
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopped) return;
    stopped = signal === 'SIGINT' ? 130 : 143;
    ffmpeg?.kill('SIGKILL');
    void ffmpegDone
      .then(() => written.forEach((f) => rmSync(f, { force: true })))
      .then(cleanup)
      .finally(() => process.exit(stopped));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  // A write comes right after this check, so a signal must run its handler first.
  const proceed = async () => {
    await yieldLoop();
    if (stopped) throw new Error('stopped');
  };
  let code = 0;
  try {
    launching = launch(found.path, join(temp, 'profile'));
    const browser = await launching;
    const viewport = { width: Math.ceil(Number(size[1])), height: Math.ceil(Number(size[2])) };
    const { pngs } = await captureFrames(browser.cdp, pageHtml(svg, basename(path)), { ...viewport, scale, fps, dark });
    const wait = delays(pngs.length, fps);
    // The GIF keeps the PNG bytes: a decoded 2400 x 1600 frame is 15 MB.
    const gif = await encodeGif(
      pngs.map((png, i) => ({ load: () => decodePng(png), delay: wait[i], same: i > 0 && png.equals(pngs[i - 1]) })),
    );
    await proceed();
    written.push(out);
    writeFileSync(out, gif);
    console.log(line(out, pngs.length, gif.length));
    if (gif.length > 10485760)
      console.error(
        `warning: ${out} is ${(gif.length / 1048576).toFixed(1)} MB, over 10 MB. Try --step <n>, a lower --fps or a lower --scale.`,
      );
    if (mp4) {
      const mp4Path = out.replace(/(\.gif)?$/, '.mp4');
      const ffmpegBin = process.env.FLOWFIG_FFMPEG ?? 'ffmpeg';
      if (spawnSync(ffmpegBin, ['-version']).error) console.error('gif: no ffmpeg on the PATH, so no MP4. The GIF is written.');
      else {
        await proceed();
        written.push(mp4Path);
        // yuv420p needs an even width and height, so the pad filter adds a pixel.
        ffmpeg = spawn(ffmpegBin, [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'image2pipe',
          '-framerate',
          String(fps),
          '-c:v',
          'png',
          '-i',
          '-',
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          mp4Path,
        ]);
        let stderr = '';
        ffmpeg.stderr!.on('data', (d: Buffer) => (stderr += d));
        // ffmpeg can exit early; the exit code reports that.
        ffmpeg.stdin!.on('error', () => {});
        ffmpeg.stdin!.end(Buffer.concat(pngs));
        const status = await (ffmpegDone = new Promise<number | null>((done) => {
          ffmpeg!.once('error', () => done(-1));
          ffmpeg!.once('close', done);
        }));
        await proceed();
        if (status !== 0) {
          rmSync(mp4Path, { force: true });
          throw new Error(`ffmpeg failed: ${stderr.trim()}`);
        }
        console.log(line(mp4Path, pngs.length, statSync(mp4Path).size));
      }
    }
  } catch (e) {
    if (!stopped) console.error(`gif: ${(e as Error).message}`);
    code = 1;
  } finally {
    await cleanup();
  }
  // A late signal runs its handler in this await, before the exit.
  await yieldLoop();
  if (stopped) written.forEach((f) => rmSync(f, { force: true }));
  process.exit(stopped || code);
}

const command = args[0] === 'check' ? args.shift()! : 'render';
const json = flag('--json'),
  strict = flag('--strict'),
  skip = flag('--no-check'),
  open = flag('--open');
if (command === 'check' && open) usage('--open works with a render, not with check');
const opts = { width: value('--width'), minText: value('--min-text') };
const unknown = args.find((a) => a.startsWith('-') && a !== '-');
if (unknown) usage(`unknown flag ${unknown}`);
const [input, out] = args;
if (!input) usage(USAGE);

const props = await load(input);

const findings: Finding[] = skip ? [] : sortFindings(check(props, opts), strict);
const errors = findings.filter((f) => f.severity === 'error').length;

const report = (print: (s: string) => void, tty: boolean | undefined) => {
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
const withSpec = svgWithSpec(props, opts);
writeFileSync(dest, withSpec);
console.log(`${dest} — ${(withSpec.length / 1024).toFixed(1)} kB`);
if (open) {
  try {
    console.log(openedLine((await openSvg(dest))[0]));
  } catch (e) {
    console.error(`open: ${(e as Error).message}`);
    process.exit(1);
  }
}
