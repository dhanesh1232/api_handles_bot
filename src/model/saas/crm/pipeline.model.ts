import mongoose, { type Schema } from "mongoose";

const pipelineSchema: Schema<IPipeline> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    order: {
      type: Number,
      default: 0,
    },
    isDefault: {
      type: Boolean,
      default: false,
      // Only one pipeline per client can be default.
      // Enforced in service layer via setDefault().
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Compound index — fast lookup for a client's pipelines
pipelineSchema.index({ clientCode: 1, isActive: 1, order: 1 });
pipelineSchema.index({ clientCode: 1, isDefault: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export { pipelineSchema as PipelineSchema };
export default pipelineSchema;
