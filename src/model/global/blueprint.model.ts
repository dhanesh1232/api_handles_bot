import mongoose, { type Document, type Model } from "mongoose";

export interface IBlueprint extends Document {
  name: string;
  description?: string;
  category: "real-estate" | "health" | "e-commerce" | "agency-default" | "custom";
  isPublic: boolean; // Whether other agencies can see/use this
  ownerAgencyId?: string; // If custom, who owns it
  content: {
    pipelines?: any[];      // Array of pipeline & stage configs
    automationRules?: any[]; // Array of automation triggers & actions
    leadFields?: any[];     // Custom field definitions
    scoringConfigs?: any[]; // Scoring rules
  };
  version: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const BlueprintSchema = new mongoose.Schema<IBlueprint>(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    category: {
      type: String,
      enum: ["real-estate", "health", "e-commerce", "agency-default", "custom"],
      default: "custom",
    },
    isPublic: { type: Boolean, default: false },
    ownerAgencyId: { type: String, index: true },
    content: {
      pipelines: { type: mongoose.Schema.Types.Mixed, default: [] },
      automationRules: { type: mongoose.Schema.Types.Mixed, default: [] },
      leadFields: { type: mongoose.Schema.Types.Mixed, default: [] },
      scoringConfigs: { type: mongoose.Schema.Types.Mixed, default: [] },
    },
    version: { type: String, default: "1.0.0" },
  },
  { timestamps: true }
);

export const Blueprint: Model<IBlueprint> =
  mongoose.models.Blueprint || mongoose.model<IBlueprint>("Blueprint", BlueprintSchema);
