import rateLimit from "express-rate-limit";

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
    // Rate limit per clientCode if authenticated, otherwise per IP
    return (req as any).clientCode || req.ip || "unknown";
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
  keyGenerator: (req) => (req as any).clientCode || req.ip || "unknown",
});
