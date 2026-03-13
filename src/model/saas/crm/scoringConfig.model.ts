import { Schema } from "mongoose";

// IScoringConfig is now defined globally

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
