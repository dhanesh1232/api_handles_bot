import { dbConnect } from "@/lib/config";
import { CorsOrigin } from "./cors-origin.model.ts";
import { Client } from "./clients/client.ts";

export interface DynamicOrigin {
  url: string;
  allowedHeaders: string[];
  allowedMethods: string[];
}

// 🔒 Never allow null in runtime
let cachedOrigins: DynamicOrigin[] = [];
let originSet: Set<string> = new Set();
let lastFetch = 0;

const CACHE_TTL = 60 * 1000;

// Base defaults — always allowed even if DB is unreachable
const BASE_DEFAULTS_URLS = [
  // Local dev
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  // ECODrIx platform
  "https://admin.ecodrix.com",
  "https://services.ecodrix.com",
  "https://www.ecodrix.com",
  "https://app.ecodrix.com",
  "https://ecodrix.com",
  "https://portfolio.ecodrix.com",
  // Clients
  "https://nirvisham.com",
  "https://www.nirvisham.com",
  "https://www.thepathfinderr.com",
  "https://thepathfinderr.com",
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

/** Normalize URL */
function normalizeUrl(url: string): string {
  return url.toLowerCase().trim().replace(/\/$/, "");
}

/** Get cached origins (sync use) */
export function getCachedOrigins() {
  return cachedOrigins;
}

/** Fast origin check */
export function isOriginAllowed(origin?: string): boolean {

  if (!origin) return true;
  const normalized = normalizeUrl(origin);
  return originSet.has(normalized) || originSet.has("*");
}

/**
 * 🔄 Load + refresh origins (async, NOT per request)
 */
export async function getDynamicOrigins(): Promise<DynamicOrigin[]> {
  const now = Date.now();

  if (cachedOrigins.length && now - lastFetch < CACHE_TTL) {
    return cachedOrigins;
  }

  try {
    // 1. Base defaults
    const staticOrigins: DynamicOrigin[] = BASE_DEFAULTS_URLS.map((url) => ({
      url: normalizeUrl(url),
      allowedHeaders: DEFAULT_HEADERS,
      allowedMethods: DEFAULT_METHODS,
    }));

    // 2. Admin whitelist
    await dbConnect("saas");
    const dbOrigins = await CorsOrigin.find({ isActive: true }).lean();

    const whitelistOrigins: DynamicOrigin[] = dbOrigins.map((o: any) => ({
      url: normalizeUrl(o.url),
      allowedHeaders: o.allowedHeaders || DEFAULT_HEADERS,
      allowedMethods: o.allowedMethods || DEFAULT_METHODS,
    }));

    // 3. Client domains
    await dbConnect("services");
    const activeClients = await Client.find(
      { status: "active", "business.website": { $exists: true, $ne: "" } },
      { "business.website": 1 },
    ).lean();

    const clientOrigins: DynamicOrigin[] = activeClients
      .map((c: any) => c.business?.website as string)
      .filter(Boolean)
      .map((website) => {
        try {
          const url = new URL(
            website.startsWith("http") ? website : `https://${website}`,
          );

          return {
            url: normalizeUrl(url.origin),
            allowedHeaders: DEFAULT_HEADERS,
            allowedMethods: DEFAULT_METHODS,
          } as DynamicOrigin;
        } catch {
          return null;
        }
      })
      .filter((o): o is DynamicOrigin => o !== null);

    // 4. Merge
    const map = new Map<string, DynamicOrigin>();

    [...staticOrigins, ...clientOrigins, ...whitelistOrigins].forEach(
      (origin) => {
        if (origin.url) map.set(origin.url, origin);
      },
    );

    const combined = Array.from(map.values());

    // ✅ CRITICAL FIX (you missed this earlier)
    cachedOrigins = combined;
    originSet = new Set(combined.map((o) => o.url));
    lastFetch = now;

    return cachedOrigins;
  } catch (err) {
    console.error("❌ Error fetching dynamic CORS origins:", err);

    // 🛡️ fallback (never empty)
    const fallback = BASE_DEFAULTS_URLS.map((url) => ({
      url: normalizeUrl(url),
      allowedHeaders: DEFAULT_HEADERS,
      allowedMethods: DEFAULT_METHODS,
    }));

    cachedOrigins = fallback;
    originSet = new Set(fallback.map((o) => o.url));
    lastFetch = now;

    return cachedOrigins;
  }
}

/**
 * 🔄 Force refresh (admin use)
 */
export function refreshOriginsCache() {
  cachedOrigins = [];
  originSet.clear();
  lastFetch = 0;
  console.log("🔄 CORS cache cleared");
}
