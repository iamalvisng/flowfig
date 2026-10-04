// Node cannot parse the JSX entry at ../src, so point it at the shim.
const shim = new URL('../src/node-figures.ts', import.meta.url).href;

export function resolve(specifier, context, next) {
  if (/^\.\.?\/src$/.test(specifier) && context.parentURL?.includes('/figures/')) {
    return { url: shim, shortCircuit: true, format: 'module-typescript' };
  }
  return next(specifier, context);
}
