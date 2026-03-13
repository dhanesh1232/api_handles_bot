import mongoose, { Document, Schema } from "mongoose";

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
    idempotencyKey: { type: String, index: true },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

eventLogSchema.index({ clientCode: 1, trigger: 1, createdAt: -1 });
eventLogSchema.index({ clientCode: 1, status: 1 });
eventLogSchema.index(
  { clientCode: 1, idempotencyKey: 1 },
  { sparse: true, unique: true },
);

export const EventLog =
  mongoose.models.EventLog ||
  mongoose.model<IEventLog>("EventLog", eventLogSchema);
