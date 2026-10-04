import { getCached, setCached } from './cache.ts';
import { queryUser } from './db.ts';

export function getUser(id: number) {
  const key = `users:${id}`;
  const hit = getCached(key);
  if (hit) return hit;
  const row = queryUser(id);
  setCached(key, row);
  return row;
}
