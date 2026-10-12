import { saveCart } from './cart.ts';

export function loadRules(id: number) {
  return applyDiscount(id);
}

export function applyDiscount(id: number) {
  return addTax(id * 0.9);
}

export function addTax(total: number) {
  return roundTotal(total * 1.2);
}

export function roundTotal(total: number) {
  return sumCart(Math.round(total * 100) / 100);
}

export function sumCart(total: number) {
  return saveCart(total);
}
