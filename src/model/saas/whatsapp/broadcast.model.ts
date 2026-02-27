import mongoose, { type Document } from "mongoose";

export interface IBroadcast extends Document {
  name: string;
  templateId: mongoose.Types.ObjectId;
  status:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "partially_failed";
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const BroadcastSchema = new mongoose.Schema<IBroadcast>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Template",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "completed",
        "failed",
        "partially_failed",
      ],
      default: "pending",
    },
    totalRecipients: {
      type: Number,
      default: 0,
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true, collection: "broadcasts" },
);

// Indexes
BroadcastSchema.index({ status: 1 });
BroadcastSchema.index({ createdAt: -1 });

export default BroadcastSchema;
