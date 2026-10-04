// Chrome refuses to start as root without it.
export const d = 4;

/** A public type. */
export interface E {
  /** A member. */
  a: number;
}

/** A public function. */
export function f() {}

/** An exported arrow function. */
export const g = () => 1;

/** An overload signature. */
export function h(a: string): void;
export function h(a: number): void;
export function h(a: any) {}

export const k = 1; // first trailing note
export const l = 2; // second trailing note

// return codes above 128 mean a signal.
export const m = 3;
