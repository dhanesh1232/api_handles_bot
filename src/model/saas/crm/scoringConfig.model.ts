/**
 * @module CRM/ScoringConfigModel
 * @responsibility Stores the ruleset for calculating dynamic lead scores.
 *
 * **WORKING PROCESS:**
 * - Logic: Contains an array of rules evaluating lead fields against operators.
 * - Thresholds: Defines what constitutes a "Hot" or "Cold" lead (triggers notifications).
 * - Reactivity: Lists triggers that should initiate a full score recalculation.
 */
import { Schema } from "mongoose";

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
