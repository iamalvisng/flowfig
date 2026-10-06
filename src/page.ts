export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function pageHtml(svg: string, title: string, before = '', after = ''): string {
  // Use element selectors only: figure styles use class names.
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas }
svg { display: block; max-width: 100%; height: auto }
</style>
${before}${svg}${after}
`;
}
