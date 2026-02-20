import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface IPipelineStage extends Document {
  clientCode: string;
  pipelineId: mongoose.Types.ObjectId;
  name: string;
  order: number;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
    },
    order: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: "#3b82f6", // Default blue
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const PipelineStage: Model<IPipelineStage> =
  mongoose.models.PipelineStage ||
  mongoose.model<IPipelineStage>("PipelineStage", pipelineStageSchema);

export default PipelineStage;
