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
