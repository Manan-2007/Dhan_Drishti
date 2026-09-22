/**
 * A tiny in-process cache for computed holdings. Opening a page like Analytics fires several
 * endpoints that each recompute the full portfolio (holdings + performance + benchmark + TWR);
 * this collapses those into one compute. Correctness comes from a per-user version that is bumped
 * on every write (see the mutation hook in app.ts, refreshQuotes, and the scheduler): a cache entry
 * is only served while its version still matches, so a user never sees stale data after a change.
 * A short TTL is a backstop for any write path that forgot to bump. Per-process; fine for a
 * single-service self-host.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

const versions = new Map<string, number>(); // userId → data version
const cache = new Map<string, { version: number; at: number; value: unknown }>(); // `${userId}|${portfolioId}`

const scopeKey = (userId: string, portfolioId: string | null | undefined) => `${userId}|${portfolioId ?? ""}`;

/** Invalidate one user's cached holdings (all scopes) after a change to their data. */
export function bumpHoldings(userId: string): void {
  versions.set(userId, (versions.get(userId) ?? 0) + 1);
}

/** Invalidate everyone's cache — for a background pass that writes across all users. */
export function invalidateAllHoldings(): void {
  versions.clear();
  cache.clear();
}

/** Return the cached holdings for this scope if still valid, else compute, cache, and return. */
export async function withHoldingsCache<T>(
  userId: string,
  portfolioId: string | null | undefined,
  compute: () => Promise<T>,
): Promise<T> {
  const version = versions.get(userId) ?? 0;
  const key = scopeKey(userId, portfolioId);
  const hit = cache.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < TTL_MS) return hit.value as T;

  const value = await compute();
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value; // Map preserves insertion order → evict the oldest
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { version, at: Date.now(), value });
  return value;
}
