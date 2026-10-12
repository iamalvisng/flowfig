import { charge } from './payments.ts';
import * as db from './db.ts';

type Cart = { items: number; total: number };

export function createOrder(cart: Cart) {
  const payment = charge(cart.total);
  const id = db.insertOrder(cart, payment);
  return { id, status: 'created' };
}

export function validateCart(cart: Cart) {
  return reserveStock(cart);
}

export function reserveStock(cart: Cart) {
  return sumOrder(cart);
}

export function sumOrder(cart: Cart) {
  return insertOrder(cart);
}

export function insertOrder(cart: Cart) {
  return publishPlaced(cart);
}

export function publishPlaced(cart: Cart) {
  return charge(cart.total);
}
