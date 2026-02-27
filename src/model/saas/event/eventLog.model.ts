import mongoose, { Document, Schema } from "mongoose";

export interface IEventLog extends Document {
  clientCode: string;
  trigger: string;
  phone?: string;
  email?: string;
  status: "received" | "processing" | "completed" | "partial" | "failed";
  rulesMatched: number;
  jobsCreated: number;
  meetLink?: string;
  callbackUrl?: string;
  callbackStatus: "not_required" | "sent" | "failed";
  payload?: any;
  error?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const eventLogSchema = new Schema<IEventLog>(
  {
    clientCode: { type: String, required: true, index: true },
    trigger: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    status: {
      type: String,
      enum: ["received", "processing", "completed", "partial", "failed"],
      default: "received",
    },
    rulesMatched: { type: Number, default: 0 },
    jobsCreated: { type: Number, default: 0 },
    meetLink: { type: String },
    callbackUrl: { type: String },
    callbackStatus: {
      type: String,
      enum: ["not_required", "sent", "failed"],
      default: "not_required",
    },
    payload: { type: Schema.Types.Mixed },
    error: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

eventLogSchema.index({ clientCode: 1, trigger: 1, createdAt: -1 });
eventLogSchema.index({ clientCode: 1, status: 1 });

export const EventLog =
  mongoose.models.EventLog ||
  mongoose.model<IEventLog>("EventLog", eventLogSchema);
