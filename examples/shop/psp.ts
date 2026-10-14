import { recordPayment } from './payments.ts';

export function tokenize(amount: number) {
  return callProvider(`tok_${amount}`);
}

export function callProvider(token: string) {
  return check3ds(token);
}

export function check3ds(token: string) {
  return capture(token);
}

export function capture(token: string) {
  return mapResult(token);
}

export function mapResult(token: string) {
  return recordPayment(token.length);
}
