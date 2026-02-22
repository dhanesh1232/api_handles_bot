import mongoose from "mongoose";

const scheduledWorkflowSchema = new mongoose.Schema({
  clientCode: { type: String, required: true },
  phone: { type: String, required: true },
  templateName: { type: String, required: true },
  variables: { type: Array, default: [] },
  scheduledFor: { type: Date, required: true },
  status: { 
    type: String, 
    enum: ["pending", "completed", "failed"], 
    default: "pending" 
  },
  error: { type: String },
  channel: { type: String, default: "whatsapp" },
  conversationId: { type: String },
  callbackUrl: { type: String },
  callbackMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 }
}, { timestamps: true });

// Index for efficient polling
scheduledWorkflowSchema.index({ scheduledFor: 1, status: 1 });

const ScheduledWorkflow = mongoose.models.ScheduledWorkflow || mongoose.model("ScheduledWorkflow", scheduledWorkflowSchema);

export { scheduledWorkflowSchema };
export default ScheduledWorkflow;
