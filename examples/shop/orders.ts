import { charge } from './payments.ts';
import { insertOrder } from './db.ts';

export function createOrder(cart: { items: number; total: number }) {
  const payment = charge(cart.total);
  const id = insertOrder(cart, payment);
  return { id, status: 'created' };
}
