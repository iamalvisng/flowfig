import { createOrder } from './orders.ts';

export function checkout(cart: { items: number; total: number }) {
  return createOrder(cart);
}
