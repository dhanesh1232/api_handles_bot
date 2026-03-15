/**
 * withSDK middleware
 *
 * Stamps `req.sdk` once per request, immediately after validateClientKey
 * has set `req.clientCode`. All downstream route handlers can use
 * `req.sdk` directly — no need to call createSDK() in every handler.
 *
 * Usage in router:
 *   import { withSDK } from "../../middleware/withSDK.ts";
 *
 *   router.use(validateClientKey, withSDK);
 *   // OR mount once on the sub-router:
 *   router.use(withSDK);   (when validateClientKey is already on the parent)
 *
 * For routes that need Socket.IO (WhatsApp send/react), pass io at setup:
 *   router.use(validateClientKey, withSDK(io));
 *
 * Without io (CRM routes):
 *   router.use(validateClientKey, withSDK());
 */

import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import type { Server } from "socket.io";
import { createSDK } from "@/sdk/index";
import { AuditService } from "@/services/global/audit.service";

// ─── Augment Express.Request ──────────────────────────────────────────────────
// Allows `req.sdk`, `req.log`, and `req.clientCode` to be typed throughout.
declare global {
  namespace Express {
    interface Request {
      sdk: SDK;
      log: Logger;
      clientCode?: string;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that attaches `req.sdk` bound to `req.clientCode`.
 *
 * @param io - Optional Socket.io Server (needed for WhatsApp routes).
 *             Pass null or omit for CRM/pipeline/activity routes.
 */
export function withSDK(io: Server | null = null) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const clientCode = req.clientCode!;
    req.sdk = createSDK(clientCode, io);

    // Proactive Audit Logging: Capture all mutation attempts globally
    if (["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) {
      AuditService.log({
        clientCode,
        action: `${req.method}:${req.baseUrl}${req.path}`,
        resourceType: "API_MUTATION",
        performedBy: req.headers["x-core-api-key"]
          ? "core_admin"
          : "client_api",
        severity: "info",
        metadata: {
          path: req.path,
          method: req.method,
          body: req.method === "DELETE" ? null : req.body, // Be careful with sensitive data in production
          ip: req.ip,
        },
      }).catch((err) => console.error("Audit log failed:", err));
    }

    next();
  };
}
