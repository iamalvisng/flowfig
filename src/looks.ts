import type { FigLook } from './model.ts';

const base = {
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

export const TOKENS: { light: Record<string, string>; dark: Record<string, string> } = {
  light: {
    ...base,
    bg: '#fafbfd',
    surface: '#ffffff',
    border: '#dfe7f0',
    ink: '#1d2433',
    muted: '#5d687a',
    accent: '#0074d9',
    'on-accent': '#ffffff',
    bad: '#c8352f',
    paper: '#fffdf8',
    'paper-ink': '#1d2433',
    'pic-b1': '#3b78d4',
    'pic-b2': '#8fb7ee',
    'pic-b3': '#dce9fb',
    'pic-t1': '#1d9a90',
    'pic-t2': '#78cfc5',
    'pic-t3': '#d3f0ec',
    'pic-dk': '#26344d',
    'pic-sk': '#f0c19c',
    'pic-hr': '#3c2f2c',
    'pic-pa': '#ffffff',
    'pic-sh': '#26344d21',
  },
  dark: {
    ...base,
    bg: '#131820',
    surface: '#1c2330',
    border: '#2a3343',
    ink: '#e9eef6',
    muted: '#9aa6b8',
    accent: '#4da3f0',
    'on-accent': '#0b1220',
    bad: '#ee5d57',
    paper: '#f1ede4',
    'paper-ink': '#1d2433',
    'pic-b1': '#5a97ee',
    'pic-b2': '#3a5f92',
    'pic-b3': '#263a57',
    'pic-t1': '#39bdb0',
    'pic-t2': '#2b8178',
    'pic-t3': '#1d3d3b',
    'pic-dk': '#0c1017',
    'pic-sk': '#e3b08a',
    'pic-hr': '#2a201e',
    'pic-pa': '#e9eef5',
    'pic-sh': '#00000059',
  },
};

export const PIC_CSS =
  ['b1', 'b2', 'b3', 't1', 't2', 't3', 'dk', 'sk', 'hr', 'pa', 'sh'].map((k) => `.ff-${k}{fill:var(--flowfig-pic-${k})}`).join('') +
  '.ff-ln,.ff-lt{fill:none;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}.ff-ln{stroke:var(--flowfig-pic-b1)}.ff-lt{stroke:var(--flowfig-pic-t2)}';

export const ART: Record<FigLook, string> = {
  person: `<ellipse class="ff-sh" cx="100" cy="151" rx="58" ry="6"/>
<path class="ff-b1" d="M52 150c0-42 20-70 48-70s48 28 48 70z"/>
<path class="ff-pa" d="M86 82l14 20 14-20c-4-2-9-2-14-2s-10 0-14 2z"/>
<rect class="ff-pa" x="112" y="112" width="20" height="14" rx="3"/>
<rect class="ff-b2" x="116" y="117" width="12" height="4" rx="2"/>
<circle class="ff-sk" cx="100" cy="52" r="22"/>
<path class="ff-hr" d="M78 50a22 22 0 0 1 44-2c-9 0-18-5-22-11c-4 7-13 12-22 13z"/>`,
  shop: `<ellipse class="ff-sh" cx="100" cy="151" rx="82" ry="6"/>
<rect class="ff-b3" x="38" y="64" width="124" height="86" rx="5"/>
<rect class="ff-b2" x="38" y="64" width="124" height="8"/>
<path class="ff-t1" d="M30 46h140l-6 22H36z"/>
<path class="ff-pa" d="M44 46h14l-3 22h-13zM72 46h14l-1 22h-14zM100 46h14l1 22h-14zM128 46h14l3 22h-13z"/>
<path class="ff-t1" d="M36 68a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0a7 7 0 0 0 14 0z"/>
<rect class="ff-b1" x="64" y="22" width="72" height="22" rx="6"/>
<path class="ff-pa" d="M100 27c-4 5-6 8-6 10a6 6 0 0 0 12 0c0-2-2-5-6-10z"/>
<rect class="ff-b1" x="52" y="88" width="38" height="62" rx="4"/>
<circle class="ff-pa" cx="83" cy="121" r="2"/>
<rect class="ff-dk" x="100" y="88" width="48" height="36" rx="4"/>
<path class="ff-pa" opacity=".2" d="M106 118l16-24h7l-16 24z"/>
<rect class="ff-t2" x="152" y="112" width="20" height="38" rx="4"/><rect class="ff-t1" x="152" y="120" width="20" height="4"/><rect class="ff-t1" x="152" y="138" width="20" height="4"/>`,
  desk: `<ellipse class="ff-sh" cx="100" cy="151" rx="78" ry="6"/>
<circle class="ff-sk" cx="112" cy="50" r="15"/>
<path class="ff-hr" d="M97 48a15 15 0 0 1 30-2c-6 0-12-4-15-8c-3 5-9 9-15 10z"/>
<path class="ff-t1" d="M84 104c0-22 12-36 28-36s28 14 28 36z"/>
<rect class="ff-b2" x="26" y="100" width="148" height="12" rx="4"/>
<rect class="ff-b1" x="34" y="112" width="132" height="38" rx="4"/>
<rect class="ff-b3" x="44" y="120" width="40" height="10" rx="3"/><rect class="ff-b3" x="116" y="120" width="40" height="10" rx="3"/>
<rect class="ff-dk" x="36" y="54" width="56" height="40" rx="5"/>
<rect class="ff-b3" x="42" y="60" width="44" height="28" rx="2"/>
<rect class="ff-b2" x="46" y="65" width="26" height="4" rx="2"/><rect class="ff-b2" x="46" y="73" width="34" height="4" rx="2"/><rect class="ff-t2" x="46" y="81" width="18" height="4" rx="2"/>
<rect class="ff-dk" x="58" y="94" width="12" height="7"/>
<rect class="ff-pa" x="128" y="92" width="26" height="9" rx="2"/>`,
  truck: `<ellipse class="ff-sh" cx="100" cy="151" rx="86" ry="6"/>
<rect class="ff-t2" x="14" y="66" width="112" height="58" rx="29"/>
<rect class="ff-t1" x="40" y="66" width="6" height="58"/><rect class="ff-t1" x="94" y="66" width="6" height="58"/>
<rect class="ff-t3" x="26" y="76" width="60" height="7" rx="4"/>
<rect class="ff-b1" x="10" y="122" width="176" height="12" rx="4"/>
<path class="ff-b1" d="M132 72h30c6 0 10 3 13 8l11 18v24h-54z"/>
<path class="ff-b3" d="M140 80h20c3 0 6 2 8 5l8 13h-36z"/>
<circle class="ff-sk" cx="152" cy="91" r="6"/>
<rect class="ff-pa" x="176" y="108" width="8" height="6" rx="2"/>
<circle class="ff-dk" cx="44" cy="136" r="14"/><circle class="ff-b3" cx="44" cy="136" r="5"/>
<circle class="ff-dk" cx="152" cy="136" r="14"/><circle class="ff-b3" cx="152" cy="136" r="5"/>`,
  phone: `<ellipse class="ff-sh" cx="100" cy="151" rx="46" ry="6"/>
<rect class="ff-dk" x="62" y="8" width="76" height="142" rx="14"/>
<rect class="ff-b3" x="68" y="20" width="64" height="116" rx="6"/>
<rect class="ff-t1" x="68" y="20" width="64" height="18" rx="6"/><rect class="ff-t1" x="68" y="30" width="64" height="8"/>
<rect class="ff-pa" x="74" y="46" width="52" height="20" rx="4"/><rect class="ff-b2" x="79" y="52" width="28" height="4" rx="2"/><rect class="ff-b2" x="79" y="59" width="18" height="3" rx="2"/>
<rect class="ff-pa" x="74" y="72" width="52" height="20" rx="4"/><rect class="ff-b2" x="79" y="78" width="32" height="4" rx="2"/><rect class="ff-b2" x="79" y="85" width="14" height="3" rx="2"/>
<rect class="ff-b1" x="80" y="112" width="40" height="14" rx="7"/>
<rect class="ff-b2" x="90" y="141" width="20" height="4" rx="2"/>`,
  server: `<ellipse class="ff-sh" cx="100" cy="151" rx="60" ry="6"/>
<rect class="ff-b1" x="52" y="14" width="96" height="136" rx="10"/>
<rect class="ff-dk" x="62" y="26" width="76" height="24" rx="4"/><rect class="ff-dk" x="62" y="58" width="76" height="24" rx="4"/><rect class="ff-dk" x="62" y="90" width="76" height="24" rx="4"/>
<rect class="ff-b2" x="70" y="35" width="34" height="6" rx="3"/><rect class="ff-b2" x="70" y="67" width="34" height="6" rx="3"/><rect class="ff-b2" x="70" y="99" width="34" height="6" rx="3"/>
<circle class="ff-t2" cx="118" cy="38" r="4"/><circle class="ff-t2" cx="128" cy="38" r="4"/>
<circle class="ff-t2" cx="118" cy="70" r="4"/><circle class="ff-t2" cx="128" cy="70" r="4"/>
<circle class="ff-t2" cx="118" cy="102" r="4"/><circle class="ff-t2" cx="128" cy="102" r="4"/>
<rect class="ff-b2" x="62" y="124" width="76" height="8" rx="4"/>`,
  cabinet: `<ellipse class="ff-sh" cx="100" cy="151" rx="62" ry="6"/>
<rect class="ff-b2" x="50" y="18" width="100" height="132" rx="8"/>
<rect class="ff-b3" x="58" y="26" width="84" height="36" rx="4"/><rect class="ff-pa" x="84" y="32" width="32" height="12" rx="2"/><rect class="ff-b1" x="86" y="49" width="28" height="6" rx="3"/>
<rect class="ff-b3" x="58" y="68" width="84" height="36" rx="4"/><rect class="ff-pa" x="84" y="74" width="32" height="12" rx="2"/><rect class="ff-b1" x="86" y="91" width="28" height="6" rx="3"/>
<rect class="ff-b3" x="58" y="110" width="84" height="34" rx="4"/><rect class="ff-pa" x="84" y="116" width="32" height="12" rx="2"/><rect class="ff-b1" x="86" y="132" width="28" height="6" rx="3"/>`,
  team: `<ellipse class="ff-sh" cx="100" cy="151" rx="84" ry="6"/>
<circle class="ff-sk" cx="52" cy="70" r="15"/><path class="ff-hr" d="M37 68a15 15 0 0 1 30 0c-8-2-14-6-15-10c-3 5-8 9-15 10z"/><path class="ff-b2" d="M24 150c0-34 12-58 28-58s28 24 28 58z"/>
<circle class="ff-sk" cx="148" cy="70" r="15"/><path class="ff-hr" d="M133 66a15 15 0 0 1 30 2c-4-1-10-1-15-6c-4 4-9 5-15 4z"/><path class="ff-b1" d="M120 150c0-34 12-58 28-58s28 24 28 58z"/>
<circle class="ff-sk" cx="100" cy="54" r="17"/><path class="ff-hr" d="M83 52a17 17 0 0 1 34 0c-6 0-14-4-17-9c-3 5-10 9-17 9z"/><path class="ff-t1" d="M68 150c0-40 14-66 32-66s32 26 32 66z"/>`,
  tower: `<ellipse class="ff-sh" cx="100" cy="151" rx="56" ry="6"/>
<path class="ff-ln" d="M100 40L70 150M100 40l30 110M80 112h40M88 82h24M70 150l50-38M130 150l-50-38M80 112l32-30M120 112l-32-30"/>
<circle class="ff-b1" cx="100" cy="38" r="9"/>
<path class="ff-lt" d="M80 20a28 28 0 0 0 0 36M120 20a28 28 0 0 1 0 36M66 8a46 46 0 0 0 0 60M134 8a46 46 0 0 1 0 60"/>
<rect class="ff-b2" x="64" y="146" width="72" height="6" rx="3"/>`,
  queue: `<ellipse class="ff-sh" cx="100" cy="151" rx="86" ry="6"/>
<rect class="ff-b2" x="28" y="122" width="10" height="28" rx="3"/><rect class="ff-b2" x="162" y="122" width="10" height="28" rx="3"/>
<rect class="ff-dk" x="14" y="104" width="172" height="22" rx="11"/>
<circle class="ff-b3" cx="25" cy="115" r="5"/><circle class="ff-b3" cx="175" cy="115" r="5"/>
<rect class="ff-b2" x="40" y="113" width="120" height="4" rx="2"/>
<rect class="ff-t2" x="22" y="66" width="44" height="38" rx="4"/><rect class="ff-t1" x="38" y="66" width="12" height="38"/>
<rect class="ff-b2" x="78" y="66" width="44" height="38" rx="4"/><rect class="ff-b1" x="94" y="66" width="12" height="38"/>
<rect class="ff-t2" x="134" y="66" width="44" height="38" rx="4"/><rect class="ff-t1" x="150" y="66" width="12" height="38"/>
<path class="ff-ln" d="M84 36h32m-10-10l10 10-10 10"/>`,
  gear: `<ellipse class="ff-sh" cx="100" cy="151" rx="64" ry="6"/>
<path class="ff-t1" d="M169 53L178 53L178 63L169 63L167 69L173 75L165 83L159 77L153 79L153 88L143 88L143 79L137 77L131 83L123 75L129 69L127 63L118 63L118 53L127 53L129 47L123 41L131 33L137 39L143 37L143 28L153 28L153 37L159 39L165 33L173 41L167 47z"/>
<circle class="ff-t3" cx="148" cy="58" r="9"/>
<path class="ff-b1" d="M125 88L136 89L136 103L125 104L122 114L130 121L122 132L113 127L104 133L106 143L94 147L89 138L79 138L74 147L62 143L64 133L55 127L46 132L38 121L46 114L43 104L32 103L32 89L43 88L46 78L38 71L46 60L55 65L64 59L62 49L74 45L79 54L89 54L94 45L106 49L104 59L113 65L122 60L130 71L122 78z"/>
<circle class="ff-b2" cx="84" cy="96" r="28"/>
<circle class="ff-b3" cx="84" cy="96" r="13"/>`,
  cloud: `<ellipse class="ff-sh" cx="100" cy="151" rx="62" ry="6"/>
<path class="ff-b2" d="M50 124a26 26 0 0 1-2-52a36 36 0 0 1 68-14a28 28 0 0 1 42 22a22 22 0 0 1-6 44z"/>
<path class="ff-b3" d="M56 114a16 16 0 0 1 0-32h4a26 26 0 0 1 50-10a18 18 0 0 1 32 14a14 14 0 0 1 4 28z"/>
<path class="ff-ln" d="M100 120V86m-14 13l14-14 14 14"/>
<rect class="ff-b1" x="76" y="134" width="48" height="12" rx="6"/>
<rect class="ff-b1" x="94" y="124" width="12" height="12"/>`,
};
