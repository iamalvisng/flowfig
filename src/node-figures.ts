// What a figure file gets when plain node renders it to SVG, instead of `src/index.tsx`: that module
// is JSX, which node cannot parse, and the SVG renderer needs none of it. The types are the same
// ones the React player uses, so a figure still type-checks against the real thing in the editor.
export type * from './model.ts';
