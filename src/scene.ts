import type { Pt, Rect } from './geometry.ts';

/** `need` is the measured width; without it, `check` estimates it. */
export type TextRun = { text: string; fontSize: number; room: number; need?: number; mono?: boolean };
export type SceneBox = { id: string; rect: Rect; texts: TextRun[] };
export type SceneEdge = {
  id: string;
  from: string;
  to: string;
  curve: [Pt, Pt, Pt, Pt];
  /** Corners of a straight-run edge (cross-block lanes). `check` tests them, not `curve`. */
  pts?: Pt[];
  label?: Rect;
  /** A rail row: rows of two steps never show together, so labels cannot overlap. */
  step?: number;
  /** Drawn under the boxes (a timeline dependency): `check` skips the crossing test. */
  behind?: true;
  /** Timeline elbow corners. `check` tests a `behind` edge only when it has them. */
  elbow?: Pt[];
};
export type Scene = {
  width: number;
  boxes: SceneBox[];
  edges: SceneEdge[];
  /** The smallest reading text in px, before any scale. */
  minFont: number;
  /** The drawn map area. An edge label stays inside it. */
  area?: Rect;
  /** The lane bands of a swimlanes figure. A stub pill stays inside one. */
  lanes?: { id: string; rect: Rect }[];
};
/** One fault that `flowfig check` found. `ids` name the boxes or edges. */
export type Finding = { rule: string; severity: 'error' | 'warning'; ids: string[]; message: string };
