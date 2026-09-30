// What a renderer drew, in one plain shape, so `flowfig check` can test any renderer: the SVG gives an estimated scene in node, the
// React player a measured one in the browser.
import type { Pt, Rect } from './geometry.ts';

/** One line of text in a box. `need` is the measured width; without it, the check estimates the width. */
export type TextRun = { text: string; fontSize: number; room: number; need?: number; mono?: boolean };
export type SceneBox = { id: string; rect: Rect; texts: TextRun[] };
/** `step` marks a rail row: rows of two steps never show at the same time, so their labels cannot overlap. */
/** `behind` marks an edge drawn under the boxes (a timeline dependency): `check` skips its crossing test. */
export type SceneEdge = { id: string; from: string; to: string; curve: [Pt, Pt, Pt, Pt]; label?: Rect; step?: number; behind?: true };
/** `minFont` is the smallest reading text in px, before any scale. Group frames are not boxes. */
export type Scene = { width: number; boxes: SceneBox[]; edges: SceneEdge[]; minFont: number };
/** One fault that `flowfig check` found. `rule` names the check, for example `unknown-id`, `text-overflow`, `edge-crosses-box`, `label-overlap`, `small-text`, `low-contrast`. `ids` are the boxes or edges it names. */
export type Finding = { rule: string; severity: 'error' | 'warning'; ids: string[]; message: string };
