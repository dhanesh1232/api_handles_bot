import mongoose, { type Document, type Model } from "mongoose";

export interface IClientUsage extends Document {
  clientCode: string; // The tenant this usage belongs to
  type: "whatsapp_msg" | "email_msg" | "ai_token" | "automation_run";
  totalCredits: number; // Total credits allowed/allotted
  usedCredits: number; // Currently used
  month: string; // e.g. "2024-03" for monthly tracking
  lastResetAt?: Date;
  status: "active" | "warning" | "exhausted";
  createdAt?: Date;
  updatedAt?: Date;
}

const ClientUsageSchema = new mongoose.Schema<IClientUsage>(
  {
    clientCode: { type: String, required: true, uppercase: true, index: true },
    type: {
      type: String,
      enum: ["whatsapp_msg", "email_msg", "ai_token", "automation_run"],
      required: true,
    },
    totalCredits: { type: Number, default: 0 },
    usedCredits: { type: Number, default: 0 },
    month: { type: String, required: true, index: true },
    lastResetAt: Date,
    status: {
      type: String,
      enum: ["active", "warning", "exhausted"],
      default: "active",
    },
  },
  { timestamps: true },
);

// Compound index for fast lookup of specific usage type for a client in a month
ClientUsageSchema.index({ clientCode: 1, type: 1, month: 1 }, { unique: true });

export const ClientUsage: Model<IClientUsage> =
  mongoose.models.ClientUsage ||
  mongoose.model<IClientUsage>("ClientUsage", ClientUsageSchema);
