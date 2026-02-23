import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface IPipeline extends Document {
  clientCode: string;
  name: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Pipeline: Model<IPipeline> =
  mongoose.models.Pipeline ||
  mongoose.model<IPipeline>("Pipeline", pipelineSchema);

export default Pipeline;
