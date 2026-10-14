import { createOrder } from './orders.ts';
import { updateCart } from './cart.ts';
import { readToken } from './auth.ts';

export function checkout(cart: { items: number; total: number }) {
  updateCart(cart.items);
  return createOrder(cart);
}

export function route(path: string) {
  return authenticate(path);
}

export function authenticate(token: string) {
  readToken(token);
  return rateLimit(token);
}

export function rateLimit(user: string) {
  updateCart(user.length);
  return createOrder({ items: user.length, total: 0 });
}
