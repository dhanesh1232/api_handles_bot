import mongoose, { type Schema } from "mongoose";

const autoActionSchema = new mongoose.Schema<IAutoAction>(
  {
    type: {
      type: String,
      enum: [
        "send_whatsapp",
        "send_email",
        "assign_to",
        "create_meeting",
        "add_tag",
        "webhook_notify",
      ],
      required: true,
    },
    delayMinutes: {
      type: Number,
      default: 0,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false },
);

const pipelineStageSchema: Schema<IPipelineStage> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: "#3b82f6",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isWon: {
      type: Boolean,
      default: false,
    },
    isLost: {
      type: Boolean,
      default: false,
    },
    probability: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    autoActions: {
      type: [autoActionSchema],
      default: [],
    },
  },
  { timestamps: true },
);

// Fast board load: all stages for a pipeline in order
pipelineStageSchema.index({ clientCode: 1, pipelineId: 1, order: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export { pipelineStageSchema as PipelineStageSchema };
export default pipelineStageSchema;
