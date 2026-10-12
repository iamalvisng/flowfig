import { reserveStock } from './orders.ts';

type Cart = { items: number; total: number };

export function parseCart(cart: Cart) {
  return checkItems(cart);
}

export function checkItems(cart: Cart) {
  return checkStock(cart);
}

export function checkStock(cart: Cart) {
  return checkAddress(cart);
}

export function checkAddress(cart: Cart) {
  return checkLimits(cart);
}

export function checkLimits(cart: Cart) {
  return reserveStock(cart);
}
