import { beatTimes, DARK, edgeId, LIGHT, n2, nodes, str, toBeat, type FlowProps } from './model.ts';
import { esc } from './page.ts';
import { textWidth } from './text.ts';

export type Tile = { frame: number; kinds: string[]; step: number; beat: number; text: string; say: string };
type Grid = { cols: number; rows: number; tile: number; tileH: number; width: number; height: number; warning?: string };

export function keyFrames(fig: FlowProps, o: { fps: number; every?: number; step?: number }): { tiles: Tile[]; frames: number } {
  const steps = fig.steps ?? [];
  const beats = steps.map((s) => s.flow.map(toBeat));
  const model = beatTimes(beats, fig.speed ?? 900);
  const loop = model.ends.at(-1) ?? 0;
  const dur = n2(loop || 1);
  const scale = loop ? dur / loop : 1;
  const times = {
    beats: model.beats.map((step) => step.map((b) => ({ t0: b.t0 * scale, t1: b.t1 * scale, tEnd: b.tEnd * scale }))),
    ends: model.ends.map((e) => e * scale),
  };
  const frames = Math.max(1, Math.round(dur * o.fps));
  const first = o.step ?? 1;
  const name = new Map(nodes(fig.layout).map((n) => [n.id, str(n.label) || n.id]));
  const edges = new Map(fig.edges.map((e) => [edgeId(e), e]));
  const hopText = (si: number, bi: number) =>
    beats[si][bi].hops
      .map((h) => {
        const e = edges.get(h.edge);
        if (!e) return h.edge;
        const [a, b] = h.back ? [e.to, e.from] : [e.from, e.to];
        const label = str(e.label);
        return `${name.get(a) ?? a} → ${name.get(b) ?? b}${label ? ` (${label})` : ''}`;
      })
      .join('; ') || 'no hop';
  const said = (si: number, bi: number) => {
    const at = beats[si].slice(0, bi + 1).findLastIndex((b) => b.say != null);
    return str(at === -1 ? steps[si].caption : beats[si][at].say);
  };
  const tiles: Tile[] = [];
  const add = (at: number, kind: string, si: number, bi: number, text: string, say: string) => {
    const last = tiles.at(-1);
    const frame = Math.min(frames - 1, Math.max(at, last?.frame ?? 0));
    if (last && frame === last.frame) {
      if (!last.kinds.includes(kind)) last.kinds.push(kind);
      return;
    }
    tiles.push({ frame, kinds: [kind], step: si + first, beat: bi + 1, text, say });
  };
  const f = o.fps;
  if (o.every) {
    const flat = beats.flatMap((step, si) => step.map((b, bi) => ({ si, bi, hop: b.hops.length > 0, ...times.beats[si][bi] })));
    for (let k = 0; k * o.every < dur * 1000; k++) {
      if (Math.round((k * o.every * f) / 1000) >= frames) break;
      const t = (k * o.every) / 1000;
      const at = flat.findLast((x) => x.t0 <= t) ?? flat[0];
      const kind = at.hop && t < at.t1 ? 'move' : t < at.tEnd ? 'read' : 'hold';
      add(Math.round((k * o.every * f) / 1000), kind, at.si, at.bi, hopText(at.si, at.bi), said(at.si, at.bi));
    }
    return { tiles, frames };
  }
  beats.forEach((step, si) => {
    step.forEach((b, bi) => {
      const { t0, t1, tEnd } = times.beats[si][bi];
      const text = hopText(si, bi),
        say = said(si, bi);
      if (b.hops.length) {
        add(Math.round(((t0 + Math.min(t1, tEnd)) / 2) * f), 'move', si, bi, text, say);
        if (t1 <= tEnd) add(Math.ceil(t1 * f + 0.5), 'arrive', si, bi, text, say);
      }
      add(Math.floor(tEnd * f - 0.5), 'read', si, bi, text, say);
    });
    add(Math.floor(times.ends[si] * f - 0.5), 'end', si, -1, `end of step ${si + first}: ${str(steps[si].label)}`, '');
  });
  return { tiles, frames };
}

export function sheetGrid(count: number, width: number, height: number, scale = 1): Grid {
  const [limit, gap, head, band] = [1568, 8, 24, 34].map((n) => Math.round(n * scale));
  const size = (cols: number, tile: number) => {
    const rows = Math.ceil(count / cols),
      tileH = Math.round((tile * height) / width);
    return { cols, rows, tile, tileH, width: cols * tile + (cols + 1) * gap, height: head + rows * (tileH + band) + (rows + 1) * gap };
  };
  let best = size(1, 0);
  for (let c = 1; c <= count; c++) {
    const rows = Math.ceil(count / c);
    let tile = Math.floor(Math.min((limit - (c + 1) * gap) / c, (((limit - head - (rows + 1) * gap) / rows - band) * width) / height));
    while (tile > 1 && Math.max(size(c, tile).width, size(c, tile).height) > limit) tile--;
    if (tile > best.tile) best = size(c, tile);
  }
  const small = 160 * scale;
  return best.tile < small
    ? { ...best, warning: `warning: the tiles are ${best.tile} px wide, under ${small} px. Use --step <n> to show fewer tiles.` }
    : best;
}

export function sheetSvg(
  tiles: Tile[],
  pngs: Buffer[],
  grid: Grid,
  o: { header: string; fps: number; dark: boolean; scale: number },
): string {
  const c = o.dark ? DARK : LIGHT;
  const [gap, head, band, font, pad] = [8, 24, 34, 12, 4].map((n) => Math.round(n * o.scale));
  const fit = (line: string) => {
    let cut = line;
    while (cut && textWidth(cut === line ? cut : cut + '…', font, true) > grid.tile - 2 * pad) cut = cut.slice(0, -1);
    return cut === line ? line : cut + '…';
  };
  const text = (x: number, y: number, s: string) => `<text x="${x}" y="${y}">${esc(s)}</text>`;
  const cells = tiles.map((t, i) => {
    const x = gap + (i % grid.cols) * (grid.tile + gap),
      y = head + gap + Math.floor(i / grid.cols) * (grid.tileH + band + gap);
    const line1 = `#${t.frame} · ${Math.round((t.frame * 1000) / o.fps)} ms · step ${t.step}${t.beat ? ` beat ${t.beat}` : ''} · ${t.kinds.join('+')}`;
    return (
      `<image x="${x}" y="${y}" width="${grid.tile}" height="${grid.tileH}" href="data:image/png;base64,${pngs[i].toString('base64')}"/>` +
      `<rect x="${x - 0.5}" y="${y - 0.5}" width="${grid.tile + 1}" height="${grid.tileH + 1}" fill="none" stroke="${c.border}"/>` +
      text(x + pad, y + grid.tileH + Math.round(14 * o.scale), fit(line1)) +
      text(x + pad, y + grid.tileH + Math.round(29 * o.scale), fit(t.text))
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${grid.width}" height="${grid.height}" viewBox="0 0 ${grid.width} ${grid.height}" ` +
    `font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${font}" fill="${c.fg}">` +
    `<rect width="${grid.width}" height="${grid.height}" fill="${c.surface}"/>` +
    text(gap, head - Math.round(7 * o.scale), o.header) +
    cells.join('') +
    `</svg>`
  );
}
