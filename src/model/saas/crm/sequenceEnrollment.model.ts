/**
 * @module CRM/SequenceEnrollmentModel
 * @responsibility State machine for leads progressing through complex automation sequences.
 *
 * **WORKING PROCESS:**
 * 1. Traversal: Tracks progress via `currentStep` and `status` (active, paused, completed).
 * 2. Audit: `stepResults` stores a detailed history of each step's attempt, including errors and timing.
 * 3. Scheduling: `nextStepAt` is used by the Job Queue to wake up the enrollment for the next action.
 */
import { Schema } from "mongoose";

export const SequenceEnrollmentSchema = new Schema<ISequenceEnrollment>(
  {
    ruleId: { type: Schema.Types.ObjectId, required: true },
    clientCode: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    trigger: { type: String },
    leadId: { type: Schema.Types.ObjectId },
    eventData: { type: Schema.Types.Mixed },
    resolvedVariables: { type: Schema.Types.Mixed },
    currentStep: { type: Number, default: 0 },
    totalSteps: { type: Number },
    status: {
      type: String,
      enum: ["active", "completed", "exited", "failed", "paused"],
      default: "active",
    },
    stepResults: [
      {
        stepNumber: { type: Number },
        status: {
          type: String,
          enum: ["pending", "completed", "failed", "skipped"],
        },
        executedAt: { type: Date },
        result: { type: Schema.Types.Mixed },
        error: { type: String },
      },
    ],
    nextStepAt: { type: Date },
    exitReason: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

SequenceEnrollmentSchema.index({ clientCode: 1, ruleId: 1, status: 1 });
SequenceEnrollmentSchema.index({ clientCode: 1, phone: 1 });
SequenceEnrollmentSchema.index({ nextStepAt: 1, status: 1 });
