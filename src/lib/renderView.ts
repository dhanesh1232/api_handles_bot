/**
 * renderView — lightweight HTML template renderer
 *
 * • Reads files from src/views/ on first use, then caches in-memory.
 * • Replaces __TOKEN__ placeholders with caller-supplied values.
 * • Safe for production: no eval, no loops on the FS per request.
 */
import { readFileSync } from "fs";
import { join } from "path";

// Always locate views relative to the project root (where server.ts/package.json live)
// This works in both dev (tsx) and prod (node dist/server.js)
const VIEWS_DIR = join(process.cwd(), "src", "views");

// In-memory template cache (populated at first render, not at import time)
const cache = new Map<string, string>();

/**
 * Render an HTML view file with token substitution.
 *
 * @param name - Filename inside src/views/ (e.g. "index.html")
 * @param vars - Key-value map. Each key "FOO" replaces every __FOO__ token.
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
