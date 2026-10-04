export function charge(amount: number) {
  return { id: `ch_${Math.round(amount * 100)}`, amount };
}
