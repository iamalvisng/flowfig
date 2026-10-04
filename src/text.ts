// Estimated widths: no browser here. The React player measures real text.
const FULL = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
const NARROW = /[ilj.,:;'|!()[\]ftrI ]/;
const WIDE = /[WMmw@%]/;
const TALL = /[A-Z0-9#&?]/;

export function textWidth(s: string, fontSize: number, mono = false): number {
  let em = 0;
  for (const ch of s) em += FULL.test(ch) ? 1 : mono ? 0.6 : WIDE.test(ch) ? 0.85 : NARROW.test(ch) ? 0.3 : TALL.test(ch) ? 0.64 : 0.53;
  return em * fontSize;
}

export function wrap(s: string, width: number, fontSize: number, mono = false): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!line) line = word;
      else if (textWidth(line + ' ' + word, fontSize, mono) <= width) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}
