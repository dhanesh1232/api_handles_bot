import type mongoose from "mongoose";

export interface AddJobOptions {
  /** Delay in ms before the job becomes eligible to run. Default: 0 (run immediately). */
  delayMs?: number;
  /** Lower number = higher priority. Default: 5. */
  priority?: number;
  /** Maximum number of attempts before the job is marked failed. Default: 3. */
  maxAttempts?: number;
}

export interface JobDocument {
  _id: mongoose.Types.ObjectId;
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

export interface WorkerOptions {
  /** How many jobs to process in parallel. Default: 1. */
  concurrency?: number;
  /** How often (ms) the worker polls the DB for new jobs. Default: 10_000. */
  pollIntervalMs?: number;
  /** Base delay (ms) for exponential backoff. Retry n uses: baseBackoffMs * 2^n. Default: 5_000. */
  baseBackoffMs?: number;
}

export type ProcessorFn = (job: JobDocument) => Promise<void>;
