const entries = new Map<string, unknown>();

export function getCached(key: string) {
  return entries.get(key);
}

export function setCached(key: string, value: unknown) {
  entries.set(key, value);
}
