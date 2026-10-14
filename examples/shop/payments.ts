import { sendReceipt, pickTemplate } from './mail.ts';
import { tokenize } from './psp.ts';

export function charge(amount: number) {
  pickTemplate(amount);
  sendReceipt(amount);
  return { id: `ch_${Math.round(amount * 100)}`, amount };
}

export function createIntent(amount: number) {
  tokenize(amount);
  return chargeCard(amount);
}

export function chargeCard(amount: number) {
  return recordPayment(amount);
}

export function recordPayment(amount: number) {
  return emitPaid(amount);
}

export function emitPaid(amount: number) {
  return sendReceipt(amount);
}
