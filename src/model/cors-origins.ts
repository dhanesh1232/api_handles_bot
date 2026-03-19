import { dbConnect } from "@/lib/config";
import { CorsOrigin } from "./cors-origin.model.ts";

export interface DynamicOrigin {
  url: string;
  allowedHeaders: string[];
  allowedMethods: string[];
}

let cachedOrigins: DynamicOrigin[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

// Hardcoded minimal safety defaults (to prevent lockouts)
const BASE_DEFAULTS_URLS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173", // Vite
  "https://admin.ecodrix.com",
];

const DEFAULT_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "x-client-code",
  "x-core-api-key",
  "x-socket-id",
  "x-socket-token",
  "x-socket-client-code",
  "x-ecodrix-signature",
];

const DEFAULT_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

/**
 * Fetches active CORS origins from the database and merges them with defaults and environment variables.
 * Uses an in-memory cache to avoid database overhead on every request.
 */
export async function getDynamicOrigins(): Promise<DynamicOrigin[]> {
  const now = Date.now();

  if (cachedOrigins && now - lastFetch < CACHE_TTL) {
    return cachedOrigins;
  }

  try {
    // 1. Get environment-defined origins
    const rawEnv = (process.env.ALLOWED_ORIGINS || "").replace(/^["']|["']$/g, "").trim();
    const envOriginsUrls = rawEnv ? rawEnv.split(",").map((url) => url.trim().toLowerCase()) : [];

    const staticOrigins: DynamicOrigin[] = [
      ...BASE_DEFAULTS_URLS,
      ...envOriginsUrls,
    ].map((url) => ({
      url: url.replace(/\/$/, ""),
      allowedHeaders: DEFAULT_HEADERS,
      allowedMethods: DEFAULT_METHODS,
    }));

    // 2. Fetch from Database
    await dbConnect("saas");
    const dbOrigins = await CorsOrigin.find({ isActive: true }).lean();
    const dynamicOrigins: DynamicOrigin[] = dbOrigins.map((o: any) => ({
      url: o.url.toLowerCase().trim().replace(/\/$/, ""),
      allowedHeaders: o.allowedHeaders || DEFAULT_HEADERS,
      allowedMethods: o.allowedMethods || DEFAULT_METHODS,
    }));

    // 3. Combine everything and ensure unique by URL
    const map = new Map<string, DynamicOrigin>();
    [...staticOrigins, ...dynamicOrigins].forEach((origin) => {
      if (origin.url) {
        map.set(origin.url, origin);
      }
    });

    const combined = Array.from(map.values());

    // Update cache
    cachedOrigins = combined;
    lastFetch = now;

    return cachedOrigins;
  } catch (err) {
    console.error("❌ Error fetching dynamic CORS origins:", err);

    // Fallback: merge env origins with base defaults if DB fails
    const envOriginsUrls = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((url) =>
          url.trim().toLowerCase(),
        )
      : [];

    return [...BASE_DEFAULTS_URLS, ...envOriginsUrls].map((url) => ({
      url,
      allowedHeaders: DEFAULT_HEADERS,
      allowedMethods: DEFAULT_METHODS,
    }));
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
