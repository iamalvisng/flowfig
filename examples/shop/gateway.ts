import { createOrder, validateCart } from './orders.ts';
import { findCart, updateCart } from './cart.ts';
import { parseCart } from './validate.ts';
import { readToken } from './auth.ts';

export function checkout(cart: { items: number; total: number }) {
  parseCart(cart);
  validateCart(cart);
  findCart(cart.items);
  updateCart(cart.items);
  return createOrder(cart);
}

export function route(path: string) {
  readToken(path);
  return authenticate(path);
}

export function authenticate(token: string) {
  return rateLimit(token);
}

export function rateLimit(user: string) {
  updateCart(user.length);
  return createOrder({ items: user.length, total: 0 });
}
