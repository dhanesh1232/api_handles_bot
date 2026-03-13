import mongoose, { Schema } from "mongoose";

export const callbackLogSchema = new Schema<ICallbackLog>(
  {
    clientCode: { type: String, required: true, index: true },
    callbackUrl: { type: String, required: true },
    method: { type: String, default: "PUT" },
    payload: { type: Schema.Types.Mixed },
    jobId: { type: String },
    enrollmentId: { type: String },
    responseStatus: { type: Number, default: 0 },
    responseBody: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sent", "failed", "pending_retry"],
      default: "pending_retry",
    },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    signature: { type: String },
  },
  { timestamps: true },
);

callbackLogSchema.index({ clientCode: 1, status: 1, createdAt: -1 });

export const CallbackLog =
  mongoose.models.CallbackLog ||
  mongoose.model<ICallbackLog>("CallbackLog", callbackLogSchema);
