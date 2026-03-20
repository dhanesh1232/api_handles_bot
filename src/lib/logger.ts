/**
 * lib/logger.ts
 *
 * Structured Pino logger with child-logger helpers for tenant + request context.
 *
 * Usage:
 *   import { logger, childLogger } from "@lib/logger";
 *
 *   // Root logger
 *   logger.info("Server started");
 *
 *   // Tenant-scoped child (e.g. inside a service)
 *   const log = childLogger({ clientCode: "ACME_001" });
 *   log.info("Lead created");
 *
 *   // Request-scoped child (e.g. in middleware)
 *   const log = requestChild(req);
 *   log.warn("Slow query");
 */

import pino, { type Logger } from "pino";

const isDev = process.env.NODE_ENV !== "production";

// ─── Root logger ──────────────────────────────────────────────────────────────

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Redact sensitive fields so they never appear in logs
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-api-key"]',
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname,env,version",
            translateTime: "HH:MM:ss Z",
            singleLine: true,
          },
        },
      }
    : {
        // Production: structured JSON — pipe to your log aggregator
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
  base: {
    env: process.env.NODE_ENV ?? "development",
    version: process.env.npm_package_version ?? "unknown",
  },
});

// ─── Child logger helpers ─────────────────────────────────────────────────────

/**
 * Generates a scoped child logger for a specific tenant.
 *
 * @param clientCode - The unique identifier for the tenant.
 *
 * **DETAILED EXECUTION:**
 * 1. **Context Binding**: Uses Pino's `.child()` method to inject `clientCode` into every subsequent log line's JSON structure.
 * 2. **Traceability**: Ensures all logs generated within a tenant's request life-cycle are easily filterable in log aggregators (e.g., CloudWatch, Datadog).
 */
export function tenantLogger(clientCode: string): Logger {
  return logger.child({ clientCode });
}

/**
 * Create a child logger bound to an HTTP request.
 * Captures: method, url, requestId (x-request-id header).
 *
 * @example
 *   const log = requestChild(req);
 *   log.warn({ ms: elapsed }, "Slow handler");
 */
export function requestChild(req: {
  method: string;
  url?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  clientCode?: string;
}): Logger {
  return logger.child({
    method: req.method,
    url: req.url ?? req.path,
    requestId: req.headers["x-request-id"],
    ...(req.clientCode ? { clientCode: req.clientCode } : {}),
  });
}

/**
 * Create a child logger for a background job.
 *
 * @example
 *   const log = jobLogger("crmWorker", jobId);
 *   log.info("Processing job");
 */
export function jobLogger(queue: string, jobId?: string): Logger {
  return logger.child({ queue, ...(jobId ? { jobId } : {}) });
}
