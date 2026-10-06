#!/usr/bin/env node
// Node 22 or newer strips the types.
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

register('./figure-loader.mjs', import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const at = ['check', 'verify', 'diff'].includes(args[0]) ? 1 : 0;

if (
  args[at] &&
  !['docs', 'init', 'draw', 'help', 'mcp', 'open', 'gif', 'atlas', 'from-mermaid'].includes(args[at]) &&
  /^\w[\w-]*$/.test(args[at])
) {
  const slug = args[at];
  args[at] = join(root, 'figures', `${slug}.ts`);
  if (!at && !(args[1] && !args[1].startsWith('--'))) args.splice(1, 0, `${slug}.svg`);
  process.argv.splice(2, Infinity, ...args);
}
await import('../src/cli.ts');
