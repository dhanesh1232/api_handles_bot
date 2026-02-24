import { dbConnect } from "../lib/config.ts";
import { CorsOrigin } from "./cors-origin.model.ts";

let cachedOrigins: string[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

// Hardcoded defaults for safety (to prevent lockouts)
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173", // Vite
  "https://services.ecodrix.com",
  "https://www.ecodrix.com",
  "https://app.ecodrix.com",
  "https://ecodrix.com",
  "https://admin.ecodrix.com",
  "https://portfolio.ecodrix.com",
  "https://nirvisham.com",
  "https://www.nirvisham.com",
];

/**
 * Fetches active CORS origins from the database and merges them with defaults.
 * Uses an in-memory cache to avoid database overhead on every request.
 */
export async function getDynamicOrigins(): Promise<string[]> {
  const now = Date.now();

  if (cachedOrigins && now - lastFetch < CACHE_TTL) {
    return cachedOrigins;
  }

  try {
    // Ensure DB connection (using saas db as specified in config)
    const db = await dbConnect("saas");

    const dbOrigins = await CorsOrigin.find({ isActive: true }).lean();
    const dynamicUrls = dbOrigins.map((o: any) => o.url);
    // Combine hardcoded and dynamic, ensure unique items
    const combined = Array.from(new Set([...DEFAULT_ORIGINS, ...dynamicUrls]));

    // Only update cache if we successfully fetched
    cachedOrigins = combined;
    lastFetch = now;

    return cachedOrigins;
  } catch (err) {
    console.error("❌ Error fetching dynamic CORS origins:", err);
    // If DB fails, fallback to last known good cache or defaults
    return cachedOrigins || DEFAULT_ORIGINS;
  }
}

/**
 * Manually invalidates the cache.
 * Call this after making changes via the CORS Admin API.
 */
export function refreshOriginsCache() {
  cachedOrigins = null;
  lastFetch = 0;
  console.log("🔄 CORS origins cache invalidated.");
}
