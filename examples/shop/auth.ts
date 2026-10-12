import { rateLimit } from './gateway.ts';

export function readToken(header: string) {
  return verifySignature(header.replace('Bearer ', ''));
}

export function verifySignature(token: string) {
  return loadUser(token.split('.')[0]);
}

export function loadUser(id: string) {
  return checkRole({ id, role: 'buyer' });
}

export function checkRole(user: { id: string; role: string }) {
  return issueContext(user);
}

export function issueContext(user: { id: string; role: string }) {
  return rateLimit(user.id);
}
