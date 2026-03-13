import { dbConnect } from "@lib/config";
import { AuditLog, type IAuditLog } from "@models/clients/auditLog";

/**
 * Global Audit Service
 * Centralized logging for agency-level accountability and transparency.
 * Logs are stored in the "services" core database.
 */
export const AuditService = {
  /**
   * Log an action to the global audit trail
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
   * Retrieve logs for a specific client (Agency View)
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
   */
  getResourceHistory: async (resourceType: string, resourceId: string) => {
    await dbConnect("services");
    return AuditLog.find({ resourceType, resourceId })
      .sort({ createdAt: -1 })
      .lean();
  }
};
