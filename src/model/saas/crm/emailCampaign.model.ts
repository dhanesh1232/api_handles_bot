import mongoose from "mongoose";

export interface IEmailCampaign extends mongoose.Document {
  name: string;
  subject: string;
  html: string;
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

export const EmailCampaignSchema = new mongoose.Schema<IEmailCampaign>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
    },
    html: {
      type: String,
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
  { timestamps: true, collection: "email_campaigns" },
);

// Indexes
EmailCampaignSchema.index({ status: 1 });
EmailCampaignSchema.index({ createdAt: -1 });

export default EmailCampaignSchema;
