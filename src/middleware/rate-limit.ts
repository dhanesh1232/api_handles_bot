import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * @module Middleware/RateLimit
 * @responsibility Prevents DOS attacks and API abuse by enforcing request frequency ceilings.
 *
 * **DETAILED EXECUTION:**
 * 1. **Key Extraction**: Injects `req.clientCode` as the unique identifier if it exists (authenticated); falls back to `req.ip` for anonymous traffic.
 * 2. **Windowing**: Uses a sliding window (e.g., 15 minutes) to track request counts.
 * 3. **Blocking**: Automatically returns `429 Too Many Requests` when a limit is breached.
 */

// General API: 200 requests per 15 minutes
export const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  keyGenerator: (req) => {
    // Rate limit per clientCode if authenticated, otherwise per IP (sanitized for IPv6 warning)
    const clientCode = (req as any).clientCode;
    if (clientCode) return clientCode;
    return ipKeyGenerator(req.ip || "unknown");
  },
});

// Strict limit for event trigger endpoint: 60 req / minute per client
export const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Trigger rate limit exceeded. Max 60 events/minute.",
  },
  keyGenerator: (req) => {
    const clientCode = (req as any).clientCode;
    if (clientCode) return clientCode;
    return ipKeyGenerator(req.ip || "unknown");
  },
});
