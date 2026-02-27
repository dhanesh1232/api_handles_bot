import { Document, Schema } from "mongoose";

export interface IScoringConfig extends Document {
  clientCode: string;
  rules: {
    field: string;
    operator:
      | "exists"
      | "not_exists"
      | "equals"
      | "not_equals"
      | "greater_than"
      | "less_than"
      | "contains";
    value?: any;
    points: number;
    label: string;
  }[];
  hotThreshold: number;
  coldThreshold: number;
  recalculateOnTriggers: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const ScoringConfigSchema = new Schema<IScoringConfig>(
  {
    clientCode: { type: String, required: true, unique: true, index: true },
    rules: [
      {
        field: { type: String, required: true },
        operator: {
          type: String,
          enum: [
            "exists",
            "not_exists",
            "equals",
            "not_equals",
            "greater_than",
            "less_than",
            "contains",
          ],
          required: true,
        },
        value: { type: Schema.Types.Mixed },
        points: { type: Number, required: true },
        label: { type: String, required: true },
      },
    ],
    hotThreshold: { type: Number, default: 70 },
    coldThreshold: { type: Number, default: 20 },
    recalculateOnTriggers: { type: [String], default: [] },
  },
  { timestamps: true },
);

ScoringConfigSchema.index({ clientCode: 1 });
