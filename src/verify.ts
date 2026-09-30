// Code links: a box, an edge or a hop names the code it draws, and `flowfig verify` checks that the code is still there.
/** `path` or `path#symbol`. No spaces, one `#` at most, both parts non-empty. `null` for a bad form. */
export function parseSource(s: string): { path: string; symbol?: string } | null {
  const m = /^([^\s#]+)(?:#([^\s#]+))?$/.exec(s);
  if (!m) return null;
  return m[2] ? { path: m[1], symbol: m[2] } : { path: m[1] };
}
