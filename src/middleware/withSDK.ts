/**
 * @module Middleware/WithSDK
 * @responsibility Dependency Injection (DI) layer that binds a tenant-scoped SDK to the request life-cycle.
 *
 * **GOAL:** Eliminate the need for manual SDK instantiation in route handlers, ensuring all business logic is automatically tenant-scoped and audited.
 *
 * **DETAILED EXECUTION:**
 * 1. **SDK Injection**: Injects `req.clientCode` into the `createSDK` factory to generate service instances (Lead, WhatsApp, etc.) pre-bound to the tenant's database.
 * 2. **Real-time Wiring**: Passes the `socket.io` instance to the SDK to enable downstream real-time notifications.
 * 3. **Implicit Auditing**: Detects state-changing operations (`POST`, `PATCH`, `DELETE`) and automatically dispatches a non-blocking log to the `AuditService`.
 */

import type { NextFunction, Request, Response } from "express";
import type { Server } from "socket.io";
import { createSDK } from "@/sdk/index";
import { AuditService } from "@/services/global/audit.service";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Higher-order middleware to attach a bound SDK to the request.
 *
 * @param io - (Optional) Socket.io server instance. If provided, allows the SDK handlers (like WhatsApp/Meeting) to emit real-time events to the frontend.
 *
 * @returns {Function} An Express middleware function `(req, res, next)`.
 *
 * @throws {Error} Implicitly assumes `req.clientCode` has been set by upstream auth middleware (e.g., `SaasAuth`).
 *
 * **DETAILED EXECUTION:**
 * 1. **Dependency Resolution**: Fetches `req.clientCode` from the request object (set by `validateClientKey`).
 * 2. **SDK Factory**: Calls `createSDK(clientCode, io)` to generate a bound instances of all CRM services.
 * 3. **Request Stamping**: Assigns the generated SDK to `req.sdk`, making it available to all subsequent middleware and route handlers.
 * 4. **Proactive Auditing (Side Effect)**:
 *    - Detects if the request is an "Active Mutation" (`POST`, `PATCH`, `DELETE`, `PUT`).
 *    - If so, it asynchronously dispatches a log to `AuditService`.
 *    - It captures the `performedBy` actor (Core Admin vs Client API) based on headers.
 *    - Captures path, method, body, and IP for a complete forensic trail.
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
