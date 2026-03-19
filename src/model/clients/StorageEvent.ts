import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IStorageEvent extends Document {
  clientCode: string;
  action: "upload" | "delete" | "folder_create" | "quota_breach" | "sync";
  key?: string; // full R2 object key
  folder?: string; // folder name
  sizeBytes?: number; // file size for upload/delete actions
  triggeredBy: "user" | "system" | "cron";
  meta?: Record<string, any>;
  createdAt: Date;
}

const StorageEventSchema = new Schema<IStorageEvent>(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["upload", "delete", "folder_create", "quota_breach", "sync"],
      required: true,
    },
    key: String, // full R2 object key (optional)
    folder: String, // folder name
    sizeBytes: Number, // file size for upload/delete actions
    triggeredBy: {
      type: String,
      enum: ["user", "system", "cron"],
      required: true,
    },
    meta: { type: Schema.Types.Mixed }, // any additional context
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

// TTL index — auto-delete records after 90 days (7,776,000 seconds)
StorageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const StorageEvent: Model<IStorageEvent> =
  mongoose.models.StorageEvent ||
  mongoose.model<IStorageEvent>("StorageEvent", StorageEventSchema);
