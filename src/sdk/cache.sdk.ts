/**
 * @file cache.sdk.ts
 * @module CacheSDK
 * @responsibility Tenant-isolated caching wrapper for the global cache service.
 * @dependencies @lib/cache
 */

import { type CacheOptions, cache } from "@lib/cache";

export class CacheSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Retrieves a value from the tenant's isolated cache.
   *
   * **WORKING PROCESS:**
   * 1. Prefixes the key with `clientCode` to ensure isolation (e.g., `ACME_001:myKey`).
   * 2. Delegates to the global `cache.get`.
   *
   * @template T
   * @param {string} key - The local key name.
   * @returns {T | undefined}
   */
  get<T>(key: string): T | undefined {
    return cache.get<T>(this.fullKey(key));
  }

  /**
   * Sets a value in the tenant's isolated cache.
   *
   * @template T
   * @param {string} key - The local key name.
   * @param {T} value - Data to cache.
   * @param {CacheOptions} [opts] - TTL and other options.
   */
  set<T>(key: string, value: T, opts?: CacheOptions): void {
    cache.set<T>(this.fullKey(key), value, opts);
  }

  /**
   * Invalidates a specific key for the current tenant.
   *
   * @param {string} key - The local key name.
   */
  del(key: string): void {
    cache.del(this.fullKey(key));
  }

  /**
   * Invalidates all keys matching a pattern within the tenant's scope.
   *
   * @param {string} pattern - Glob-style pattern (e.g., "leads:*").
   */
  delPattern(pattern: string): void {
    cache.delPattern(`${this.clientCode}:${pattern}`);
  }

  /**
   * Atomic Fetch-or-Set logic bound to the tenant.
   *
   * **WORKING PROCESS:**
   * 1. Checks if the key exists in the tenant's scope.
   * 2. If not, executes the provided generator function `fn`.
   * 3. Stores the result and returns it.
   *
   * @template T
   * @param {string} key - The local key name.
   * @param {() => Promise<T>} fn - Generator function for cache misses.
   * @param {CacheOptions} [opts] - TTL options.
   * @returns {Promise<T>}
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: CacheOptions,
  ): Promise<T> {
    return cache.getOrSet<T>(this.fullKey(key), fn, opts);
  }

  private fullKey(key: string): string {
    return `${this.clientCode}:${key}`;
  }
}
