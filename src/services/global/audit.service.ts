import { dbConnect } from "@lib/config";
import { AuditLog, type IAuditLog } from "@models/clients/auditLog";

/**
 * @file audit.service.ts
 * @module AuditService
 * @responsibility Centralized logging for agency-level accountability and transparency.
 * @dependencies dbConnect, AuditLog Model
 *
 * @example
 *   await AuditService.log({
 *     clientCode: "TENANT_123",
 *     action: "lead.created",
 *     resourceType: "Lead",
 *     resourceId: "lead_abc123",
 *     performedBy: "system",
 *     metadata: { leadId: "..." }
 *   });
 */
export const AuditService = {
  /**
   * Log an action to the global audit trail
   *
   * **WORKING PROCESS:**
   * 1. Connects to the "services" core database.
   * 2. Persists the audit log with provided parameters.
   * 3. Defaults severity to "info" if not specified.
   *
   * **EDGE CASES:**
   * - Failure to Log: Console logs the error but fails silently to avoid breaking the caller's flow.
   *
   * @param {string} clientCode - Unique tenant identifier.
   * @param {string} action - Action performed (e.g., "lead.created").
   * @param {string} resourceType - Type of resource (e.g., "Lead").
   * @param {string} resourceId - ID of the resource.
   * @param {string} performedBy - User who performed the action.
   * @param {string} [severity="info"] - Severity level.
   * @param {object} [metadata] - Additional metadata.
   * @param {string} [ip] - IP address of the user.
   * @param {string} [userAgent] - User agent of the user.
   * @returns {Promise<void>}
   */
  log: async (params: {
    clientCode?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    performedBy: string;
    severity?: IAuditLog["severity"];
    metadata?: Record<string, any>;
    ip?: string;
    userAgent?: string;
  }) => {
    try {
      await dbConnect("services");
      await AuditLog.create({
        ...params,
        severity: params.severity || "info",
      });
    } catch (err) {
      // Fail silently to the requester but log to console
      console.error("❌ [AuditService] Failed to log action:", err);
    }
  },

  /**
   * Retrieves log history filtered by clientCode for agency oversight.
   *
   * **WORKING PROCESS:**
   * 1. Multi-plexing: Connects to core DB and queries the `AuditLog` collection.
   * 2. Sorting: Returns records in descending chronological order.
   *
   * @param {string} clientCode - Unique tenant identifier.
   * @param {number} [limit=50] - Maximum number of logs to retrieve.
   */
  getClientLogs: async (clientCode: string, limit = 50) => {
    await dbConnect("services");
    return AuditLog.find({ clientCode })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  /**
   * Retrieve logs for a specific resource
   *
   * @param {string} resourceType - Type of resource (e.g., "Lead").
   * @param {string} resourceId - ID of the resource.
   * @returns {Promise<IAuditLog[]>}
   */
  getResourceHistory: async (resourceType: string, resourceId: string) => {
    await dbConnect("services");
    return AuditLog.find({ resourceType, resourceId })
      .sort({ createdAt: -1 })
      .lean();
  },
};
