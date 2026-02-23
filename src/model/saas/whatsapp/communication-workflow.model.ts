import mongoose, { type Document, type Model, type Schema } from "mongoose";

export type WorkflowTrigger =
  | "appointment_confirmed"
  | "appointment_reminder"
  | "product_purchased"
  | "service_enrolled"
  | "lead_captured";

export type WorkflowChannel = "whatsapp" | "email";

export interface ICommunicationWorkflow extends Document {
  name: string;
  trigger: WorkflowTrigger;
  channel: WorkflowChannel;
  templateName: string;
  delayMinutes: number; // 0 for instant, -60 for 1h before, etc.
  conditions?: mongoose.Schema.Types.Mixed;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const communicationWorkflowSchema: Schema<ICommunicationWorkflow> =
  new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      trigger: {
        type: String,
        required: true,
        enum: [
          "appointment_confirmed",
          "appointment_reminder",
          "product_purchased",
          "service_enrolled",
          "lead_captured",
          "appointment_cancelled",
          "appointment_rescheduled",
        ],
        index: true,
      },
      channel: {
        type: String,
        required: true,
        enum: ["whatsapp", "email"],
        default: "whatsapp",
      },
      templateName: {
        type: String,
        required: true,
      },
      delayMinutes: {
        type: Number,
        default: 0, // Instant
      },
      conditions: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },
    },
    { timestamps: true },
  );

// Ensure a tenant doesn't have duplicate workflows for same trigger/channel/delay if needed
// communicationWorkflowSchema.index({ trigger: 1, channel: 1, delayMinutes: 1 });

const CommunicationWorkflow: Model<ICommunicationWorkflow> =
  mongoose.models.CommunicationWorkflow ||
  mongoose.model<ICommunicationWorkflow>(
    "CommunicationWorkflow",
    communicationWorkflowSchema,
  );

export default CommunicationWorkflow;
