import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface ILead extends Document {
  clientCode: string;
  name?: string;
  phone: string;
  email?: string;
  source: string;
  pipelineId?: mongoose.Types.ObjectId;
  stageId?: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId;
  tags: string[];
  score: number;
  lastActivityAt?: Date;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema: Schema<ILead> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    source: {
      type: String,
      default: "manual", // website, whatsapp, booking, etc.
    },
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
    },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PipelineStage",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    tags: [String],
    score: {
      type: Number,
      default: 0,
    },
    lastActivityAt: Date,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

leadSchema.index({ clientCode: 1, phone: 1 }, { unique: true, sparse: true });

const Lead: Model<ILead> =
  mongoose.models.Lead || mongoose.model<ILead>("Lead", leadSchema);

export default Lead;
