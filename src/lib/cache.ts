/**
 * lib/cache.ts
 *
 * Lightweight in-memory cache for hot, rarely-changing data:
 *   - Pipeline lists (change only when user edits pipeline)
 *   - Lead field definitions (static per tenant)
 *   - Auth/secrets lookups (short TTL)
 *
 * Uses a Map with per-entry TTL. No external dependency needed.
 * For multi-instance deployments, swap the internal store for Redis
 * by replacing the Map with an ioredis client — the API stays identical.
 *
 * Usage:
 *   import { cache } from "@lib/cache";
 *
 *   const pipelines = await cache.getOrSet(
 *     `pipelines:${clientCode}`,
 *     () => pipelineService.getPipelines(clientCode),
 *     { ttlSeconds: 60 }
 *   );
 *
 *   // Invalidate on mutation
 *   cache.del(`pipelines:${clientCode}`);
 *
 *   // Wildcard invalidation (e.g. all keys for a tenant)
 *   cache.delPattern(`pipelines:ACME*`);
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // ms since epoch
}

export interface CacheOptions {
  ttlSeconds?: number;
}

export interface ICache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, opts?: CacheOptions): void;
  del(key: string): void;
  delPattern(pattern: string): void;
  getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: CacheOptions,
  ): Promise<T>;
  flush(): void;
}

class InMemoryCache implements ICache {
  private store = new Map<string, CacheEntry<unknown>>();

  // ─── Core operations ───────────────────────────────────────────────────────

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, opts: CacheOptions = {}): void {
    const ttlMs = (opts.ttlSeconds ?? 60) * 1000;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  /**
   * Delete all keys matching a prefix pattern (e.g. "pipelines:ACME*").
   * Only supports trailing wildcard.
   */
  delPattern(pattern: string): void {
    const prefix = pattern.replace(/\*$/, "");
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  // ─── Fetch-or-set ──────────────────────────────────────────────────────────

  /**
   * Return cached value if present and fresh; otherwise execute `fn`,
   * cache the result, and return it.
   *
   * @example
   *   const pipelines = await cache.getOrSet(
   *     `pipelines:${clientCode}`,
   *     () => getPipelines(clientCode),
   *     { ttlSeconds: 120 }
   *   );
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    opts: CacheOptions = {},
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await fn();
    this.set(key, value, opts);
    return value;
  }

  // ─── Introspection (dev/admin only) ───────────────────────────────────────

  /** Returns the number of live (non-expired) entries. */
  size(): number {
    this.evict();
    return this.store.size;
  }

  /** Evict all expired entries. Called automatically on size(). */
  evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Clear all entries (e.g. during tests or forced refresh). */
  flush(): void {
    this.store.clear();
  }
}

/** Singleton cache instance shared across the process. */
export const cache = new InMemoryCache();

// ─── Sugared helpers for common patterns ─────────────────────────────────────

/**
 * Cache key helpers so key names stay consistent and typo-free.
 *
 * @example
 *   const key = CacheKey.pipelines("ACME_001");
 *   // → "pipelines:v1:ACME_001"
 */
export const CacheKey = {
  pipelines: (clientCode: string) => `pipelines:v1:${clientCode}`,
  leadFields: (clientCode: string) => `lead_fields:v1:${clientCode}`,
  clientSecrets: (clientCode: string) => `secrets:v1:${clientCode}`,
} as const;
