#!/usr/bin/env node
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const USAGE =
  'usage: npm run export -- [figure...] [--gif] [--dark] [--2x] [--square] [--out <folder>]\n' +
  'The default output folder is ~/Downloads/flowfig-clips.';
const NEEDS = 'needs: npx playwright install chromium (once), and ffmpeg on PATH.';
if (process.argv.includes('--help')) {
  console.log(`${USAGE}\n${NEEDS}`);
  process.exit(0);
}
const { chromium } = await import('playwright').catch(() => {
  console.error(`playwright is missing. ${NEEDS}`);
  process.exit(1);
});
await run('ffmpeg', ['-version']).catch(() => {
  console.error(`ffmpeg is missing. ${NEEDS}`);
  process.exit(1);
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = outAt === -1 ? join(homedir(), 'Downloads', 'flowfig-clips') : args[outAt + 1];
const RAW = join(OUT, '.raw');
const rest = outAt === -1 ? args : [...args.slice(0, outAt), ...args.slice(outAt + 2)];
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const only = rest.filter((a) => !a.startsWith('--'));
const dark = flags.has('--dark');
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const playStep = (page, step, fast) =>
  page.evaluate(
    async ({ i, fast }) => {
      window.startExport(i);
      if (fast) {
        for (let tries = 0; tries < 50; tries++) {
          const button = document.querySelector('button[title="Playback speed"]');
          if (button?.innerText.startsWith('2')) break;
          button?.click();
          await new Promise((r) => setTimeout(r, 20));
        }
        if (!document.querySelector('button[title="Playback speed"]')?.innerText.startsWith('2')) throw new Error('2x never took');
      }
      const width = () => {
        const bar = document.querySelector('[role=tab][aria-selected=true] div');
        return bar ? parseFloat(bar.style.transform.slice(7)) || 0 : 0;
      };
      // At 2x, the full moment can fall between two polls.
      let prev = 0;
      for (let waited = 0; waited < 120_000; waited += 50) {
        const now = width();
        if (now > 0.995 || (prev > 0.5 && now < prev - 0.2)) return;
        prev = now;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`step ${i} never finished`);
    },
    { i: step, fast },
  );

const server = await createServer({ root, server: { port: 0 }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
await rm(RAW, { recursive: true, force: true });

try {
  const figures = (await readdir(join(root, 'figures'))).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
  for (const figure of only.length ? only : figures) {
    const url = `${base}/?export${dark ? '&dark' : ''}#${figure}`;

    const probe = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    await probe.goto(url);
    const steps = await probe.evaluate(() => window.exportSteps);
    const narration = await probe.evaluate(() => window.exportNarration);
    await probe.evaluate(() => window.startExport(0));
    await probe.waitForSelector('.flowfig');
    const box = await probe.evaluate(() => {
      const el = document.querySelector('#root > div');
      const r = el.getBoundingClientRect();
      // H.264 wants even dimensions.
      return { width: 2 * Math.ceil(r.width / 2), height: 2 * Math.ceil(r.height / 2) };
    });
    await probe.close();

    for (const [i, label] of steps.entries()) {
      const name = `${figure}-${slug(label)}`;
      const context = await browser.newContext({ viewport: box, recordVideo: { dir: RAW, size: box } });
      const startedAt = Date.now();
      const page = await context.newPage();
      await page.goto(url);
      const blankLead = (Date.now() - startedAt) / 1000;
      await playStep(page, i, flags.has('--2x'));
      const video = page.video();
      // The video file is complete only after the context closes.
      await context.close();
      const webm = await video.path();

      const base = `${name}${flags.has('--square') ? '-square' : ''}`;
      const mp4 = join(OUT, `${base}.mp4`);
      const side = Math.max(box.width, box.height);
      const square = flags.has('--square') ? ['-vf', `pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=${dark ? '0x1b1b1d' : 'white'}`] : [];
      // +faststart moves the index first, so a browser can show the clip at once.
      await run('ffmpeg', [
        // prettier-ignore
        '-y',
        '-ss',
        String(blankLead),
        '-i',
        webm,
        '-an',
        '-c:v',
        'libx264',
        '-crf',
        '20',
        '-preset',
        'slow',
        ...square,
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        mp4,
      ]);
      if (flags.has('--gif')) {
        const palette = join(RAW, `${name}.png`);
        const filters = 'fps=15,scale=900:-2:flags=lanczos';
        await run('ffmpeg', ['-y', '-ss', String(blankLead), '-i', webm, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
        await run('ffmpeg', [
          '-y',
          '-ss',
          String(blankLead),
          '-i',
          webm,
          '-i',
          palette,
          '-lavfi',
          `${filters}[x];[x][1:v]paletteuse=dither=bayer`,
          join(OUT, `${name}.gif`),
        ]);
      }
      const { label: heading, says } = narration.steps[i];
      const md = [`# ${narration.title} — ${heading}`, '', ...says.map((s) => `- ${s}`), ''].join('\n');
      await writeFile(join(OUT, `${base}.md`), md);
      console.log(`${join(OUT, base)}.mp4  ${box.width}x${box.height}  (+ .md, ${says.length} lines)`);
    }
  }
} finally {
  await browser.close();
  await server.close();
  await rm(RAW, { recursive: true, force: true });
}
