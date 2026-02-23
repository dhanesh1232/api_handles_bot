import type { IJob } from "../../model/queue/job.model.ts";
import Job from "../../model/queue/job.model.ts";
import { dbConnect } from "../config.js";
import type { WorkerOptions } from "./types.ts";

/**
 * MongoWorker — polls the central jobs collection for the given queue name
 * and processes them with concurrency control and automatic retry/backoff.
 *
 * Usage:
 *   const worker = new MongoWorker("whatsapp-workflow", myProcessorFn, {
 *     concurrency: 3,
 *     pollIntervalMs: 10_000,
 *   });
 *   worker.start();
 */
export class MongoWorker {
  private queueName: string;
  private processor: (job: IJob) => Promise<void>;
  private concurrency: number;
  private pollIntervalMs: number;
  private baseBackoffMs: number;

  /** Count of currently executing jobs — used to enforce concurrency limit. */
  private running = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    queueName: string,
    processor: (job: IJob) => Promise<void>,
    opts: WorkerOptions = {},
  ) {
    this.queueName = queueName;
    this.processor = processor;
    this.concurrency = opts.concurrency ?? 1;
    this.pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    this.baseBackoffMs = opts.baseBackoffMs ?? 5_000;
  }

  start() {
    console.log(
      `[MongoWorker:${this.queueName}] Starting — concurrency=${this.concurrency}, poll=${this.pollIntervalMs}ms`,
    );
    // Run once immediately, then on interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`[MongoWorker:${this.queueName}] Stopped.`);
    }
  }

  private async poll() {
    await dbConnect("services");

    const available = this.concurrency - this.running;
    if (available <= 0) return; // Already at capacity

    const now = new Date();

    // Claim up to `available` jobs atomically — one at a time to avoid races.
    // findOneAndUpdate with status transition is the MongoDB equivalent of SKIP LOCKED.
    const claimed: IJob[] = [];

    for (let i = 0; i < available; i++) {
      const job = await Job.findOneAndUpdate(
        {
          queue: this.queueName,
          status: "waiting",
          runAt: { $lte: now },
        },
        { $set: { status: "active" } },
        {
          new: true,
          sort: { priority: 1, runAt: 1 }, // highest priority (lowest number), oldest first
        },
      ).lean<IJob>();

      if (!job) break; // No more jobs ready
      claimed.push(job);
    }

    for (const job of claimed) {
      this.running++;
      this.execute(job).finally(() => this.running--);
    }
  }

  private async execute(job: IJob) {
    try {
      await this.processor(job);

      await Job.findByIdAndUpdate(job._id, {
        $set: { status: "completed", completedAt: new Date() },
      });

      console.log(
        `[MongoWorker:${this.queueName}] ✅ Job ${job._id} completed`,
      );
    } catch (err: any) {
      const attempts = job.attempts + 1;
      const isExhausted = attempts >= job.maxAttempts;

      // Exponential backoff: delay = baseBackoffMs * 2^attempts
      const backoffMs = this.baseBackoffMs * Math.pow(2, attempts);
      const runAt = new Date(Date.now() + backoffMs);

      if (isExhausted) {
        await Job.findByIdAndUpdate(job._id, {
          $set: {
            status: "failed",
            attempts,
            lastError: err.message,
            failedAt: new Date(),
          },
        });
        console.error(
          `[MongoWorker:${this.queueName}] ❌ Job ${job._id} permanently failed after ${attempts} attempts: ${err.message}`,
        );
      } else {
        // Re-queue with backoff
        await Job.findByIdAndUpdate(job._id, {
          $set: {
            status: "waiting",
            attempts,
            lastError: err.message,
            runAt,
          },
        });
        console.warn(
          `[MongoWorker:${this.queueName}] ⚠️ Job ${job._id} failed (attempt ${attempts}/${job.maxAttempts}), retrying at ${runAt.toISOString()}`,
        );
      }
    }
  }
}
