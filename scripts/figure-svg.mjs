#!/usr/bin/env node
/**
 * The repo front for the package CLI (src/cli.ts): it also takes a figure slug from figures/.
 *
 *   npm run svg -- - out.svg < spec.json        # a spec on stdin: nothing is left on disk
 *   npm run svg -- cached-request               # a figure in figures/ -> cached-request.svg
 *   npm run svg -- check cached-request         # list the faults of a figure in figures/
 *   npm run svg -- spec.json out.svg            # a spec file
 *   npm run svg -- --spec out.svg               # print back the spec the SVG carries
 *
 * No install, no browser: plain node (22+ strips the types on the way in).
 */
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

register('./figure-loader.mjs', import.meta.url); // lets a figure file load without its JSX entry
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const at = args[0] === 'check' ? 1 : 0; // where the input sits

// A bare name is a figure slug; anything else goes to the CLI as it is. A render gets a default output path, unless one follows.
if (args[at] && !['docs', 'init'].includes(args[at]) && /^\w[\w-]*$/.test(args[at])) {
  const slug = args[at];
  args[at] = join(root, 'figures', `${slug}.ts`);
  if (!at && !(args[1] && !args[1].startsWith('--'))) args.splice(1, 0, `${slug}.svg`);
  process.argv.splice(2, Infinity, ...args);
}
await import('../src/cli.ts');
