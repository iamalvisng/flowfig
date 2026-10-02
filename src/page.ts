// The page that holds a figure SVG: `flowfig open` shows it in the default browser, and `flowfig gif` captures it. Pure.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page: the figure SVG inline, centered, scaled down to the window width. The title is escaped. */
export function pageHtml(svg: string, title: string): string {
  // Element selectors only: the figure styles use class names, so the two sets of rules do not meet.
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas }
svg { display: block; max-width: 100%; height: auto }
</style>
${svg}
`;
}
