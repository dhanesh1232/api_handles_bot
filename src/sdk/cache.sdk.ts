import { type CacheOptions, cache } from "@lib/cache";

export class CacheSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Get a value from the cache for the current tenant.
   */
  get<T>(key: string): T | undefined {
    return cache.get<T>(this.fullKey(key));
  }

  /**
   * Set a value in the cache for the current tenant.
   */
  set<T>(key: string, value: T, opts?: CacheOptions): void {
    cache.set<T>(this.fullKey(key), value, opts);
  }

  /**
   * Delete a key from the cache for the current tenant.
   */
  del(key: string): void {
    cache.del(this.fullKey(key));
  }

  /**
   * Delete keys matching a pattern for the current tenant.
   */
  delPattern(pattern: string): void {
    cache.delPattern(`${this.clientCode}:${pattern}`);
  }

  /**
   * Fetch-or-set pattern bound to the tenant.
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
