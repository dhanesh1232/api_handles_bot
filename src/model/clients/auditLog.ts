import mongoose, { type Document, type Model } from "mongoose";

export interface IAuditLog extends Document {
  clientCode?: string; // Optional if it's a global action (e.g. creating a client)
  action: string; // e.g. "crm.lead.create", "client.secrets.update"
  resourceType: string; // e.g. "Lead", "ClientSecrets", "AutomationRule"
  resourceId?: string;
  performedBy: string; // "api_key", "system", or user ID if available
  severity: "info" | "warn" | "error" | "critical";
  metadata: Record<string, any>; // Context, diffs, payload snippets
  ip?: string;
  userAgent?: string;
  createdAt?: Date;
}

const AuditLogSchema = new mongoose.Schema<IAuditLog>(
  {
    clientCode: { type: String, uppercase: true, index: true },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true, index: true },
    resourceId: { type: String, index: true },
    performedBy: { type: String, required: true, index: true },
    severity: {
      type: String,
      enum: ["info", "warn", "error", "critical"],
      default: "info",
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL index to keep logs lean (e.g. 90 days for standard logs)
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
