/** Stable 1–15 minute spread for retries tied to one issue or run. */
export function quotaResetSpreadMs(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 60_000 + ((hash >>> 0) % 840_001);
}
