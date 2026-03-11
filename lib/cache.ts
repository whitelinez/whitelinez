/**
 * lib/cache.ts — Global in-memory TTL cache shared across all modules.
 * Ported verbatim from src/core/cache.js.
 *
 * Cache keys used by this app:
 *   "ws:token"         — /api/token response (4 min TTL)
 *   "round:preferred"  — fetchPreferredRound() result (30 s TTL)
 *   "lb:<windowSec>"   — leaderboard data per window duration (30 s TTL)
 *   "analytics:<url>"  — analytics API response (2 min TTL)
 */

interface CacheEntry<T> {
  v: T;
  exp: number;
}

const _store = new Map<string, CacheEntry<unknown>>();

function set<T>(key: string, data: T, ttlMs: number): void {
  _store.set(key, { v: data, exp: Date.now() + ttlMs });
}

function get<T>(key: string): T | null {
  const entry = _store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.exp) { _store.delete(key); return null; }
  return entry.v;
}

function invalidate(keyOrPrefix: string): void {
  if (_store.has(keyOrPrefix)) { _store.delete(keyOrPrefix); return; }
  for (const k of _store.keys()) {
    if (k.startsWith(keyOrPrefix)) _store.delete(k);
  }
}

function clear(): void { _store.clear(); }

export const AppCache = { set, get, invalidate, clear };
