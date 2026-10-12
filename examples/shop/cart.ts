import { loadRules } from './pricing.ts';

export function updateCart(items: number) {
  return { items };
}

export function findCart(id: number) {
  return addItem(id);
}

export function addItem(id: number) {
  loadRules(id);
  return priceCart(id);
}

export function priceCart(id: number) {
  return saveCart(id);
}

export function saveCart(id: number) {
  return { id, saved: true };
}
