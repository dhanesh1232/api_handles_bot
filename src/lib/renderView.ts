/**
 * renderView — lightweight HTML template renderer
 *
 * • Reads files from src/views/ on first use, then caches in-memory.
 * • Replaces __TOKEN__ placeholders with caller-supplied values.
 * • Safe for production: no eval, no loops on the FS per request.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Always locate views relative to the project root (where server.ts/package.json live)
// This works in both dev (tsx) and prod (node dist/server.js)
const VIEWS_DIR = join(process.cwd(), "src", "views");

// In-memory template cache (populated at first render, not at import time)
const cache = new Map<string, string>();

/**
 * Renders an HTML view with high-speed token replacement and intelligent caching.
 *
 * @param name - View filename (e.g., "welcome.html").
 * @param vars - Key-value pairs for substitution.
 *
 * **DETAILED EXECUTION:**
 * 1. **Cache Strategy**: In Production, reads from disk only once and persists the string in memory. In Development, re-reads every time to support hot-reload.
 * 2. **Token Replacement**: Uses a global split/join pattern for `__TOKEN__` markers, which is significantly faster than regex for large HTML blobs.
 * 3. **Safety**: Operates as a pure string transformation engine with no `eval()` or dangerous execution paths.
 */
export function renderView(
  name: string,
  vars: Record<string, string> = {},
): string {
  const isProd = process.env.NODE_ENV === "production";

  if (!cache.has(name) || !isProd) {
    const raw = readFileSync(join(VIEWS_DIR, name), "utf8");
    cache.set(name, raw);
  }

  let html = cache.get(name)!;

  for (const [key, value] of Object.entries(vars)) {
    // Global replace — one token can appear many times (e.g. __VERSION__)
    html = html.split(`__${key}__`).join(value);
  }

  return html;
}

/**
 * Evict a cached template (useful during development hot-reload scenarios).
 */
export function evictView(name: string): void {
  cache.delete(name);
}
