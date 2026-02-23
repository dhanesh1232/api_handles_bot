import mongoose, { type Document, type Model } from "mongoose";

export interface IJob extends Document {
  queue: string;
  status: "waiting" | "active" | "completed" | "failed";
  data: Record<string, unknown>;
  priority: number;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  completedAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new mongoose.Schema<IJob>(
  {
    /** Named queue this job belongs to, e.g. "whatsapp-workflow" */
    queue: { type: String, required: true, index: true },

    /** Lifecycle state */
    status: {
      type: String,
      enum: ["waiting", "active", "completed", "failed"],
      default: "waiting",
    },

    /** Arbitrary payload — the processor receives this */
    data: { type: mongoose.Schema.Types.Mixed, required: true },

    /** Lower = higher priority. Default 5. */
    priority: { type: Number, default: 5 },

    /** Earliest time the job may be processed (supports delayed jobs) */
    runAt: { type: Date, default: () => new Date() },

    /** How many times execution has been attempted */
    attempts: { type: Number, default: 0 },

    /** Maximum allowed attempts before moving to "failed" */
    maxAttempts: { type: Number, default: 3 },

    /** Last error message, populated on failure */
    lastError: { type: String },

    completedAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true }
);

/**
 * Compound index covering the worker's polling query.
 * Sorted by priority asc then runAt asc → highest-priority, oldest jobs first.
 */
jobSchema.index({ queue: 1, status: 1, runAt: 1, priority: 1 });

const Job: Model<IJob> =
  mongoose.models.Job ?? mongoose.model<IJob>("Job", jobSchema);

export default Job;
