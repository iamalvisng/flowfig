const orders: unknown[] = [];

export function insertOrder(cart: unknown, payment: unknown) {
  return orders.push({ cart, payment });
}

export function queryUser(id: number) {
  return { id, name: 'Ada Lovelace' };
}
