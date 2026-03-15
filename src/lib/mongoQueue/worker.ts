import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import type { IJob } from "@models/queue/job.model";
import Job from "@models/queue/job.model";
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
  private maxJobsPerSecond: number | null;

  /** Rate limiting state */
  private jobsStartedInLastSecond = 0;
  private lastSecondStart = Date.now();

  /** Count of currently executing jobs — used to enforce concurrency limit. */
  private running = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isStopping = false;

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
    this.maxJobsPerSecond = opts.maxJobsPerSecond ?? null;
  }

  start() {
    logger.info(
      {
        queue: this.queueName,
        concurrency: this.concurrency,
        pollIntervalMs: this.pollIntervalMs,
      },
      `[MongoWorker] Starting`,
    );
    // Run once immediately, then on interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop() {
    this.isStopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ queue: this.queueName }, `[MongoWorker] Stopped.`);
    }
  }
  private async poll() {
    if (this.isStopping) return;

    await dbConnect("services");

    const now = Date.now();
    if (now - this.lastSecondStart >= 1000) {
      this.jobsStartedInLastSecond = 0;
      this.lastSecondStart = now;
    }

    let available = this.concurrency - this.running;
    if (this.maxJobsPerSecond !== null) {
      const remainingForRateLimit =
        this.maxJobsPerSecond - this.jobsStartedInLastSecond;
      available = Math.min(available, remainingForRateLimit);
    }

    if (available <= 0) return; // Already at capacity or rate limited

    const nowDate = new Date();

    // Claim up to `available` jobs atomically — one at a time to avoid races.
    // findOneAndUpdate with status transition is the MongoDB equivalent of SKIP LOCKED.
    const claimed: IJob[] = [];

    for (let i = 0; i < available; i++) {
      const job = await Job.findOneAndUpdate(
        {
          queue: this.queueName,
          status: "waiting",
          runAt: { $lte: nowDate },
        },
        { $set: { status: "active" } },
        {
          returnDocument: "after",
          sort: { priority: 1, runAt: 1 }, // highest priority (lowest number), oldest first
        },
      ).lean<IJob>();

      if (!job) break; // No more jobs ready
      claimed.push(job);
    }

    for (const job of claimed) {
      this.running++;
      this.jobsStartedInLastSecond++;
      this.execute(job).finally(() => this.running--);
    }
  }

  private async execute(job: IJob) {
    try {
      await this.processor(job);

      await Job.findByIdAndUpdate(job._id, {
        $set: { status: "completed", completedAt: new Date() },
      });

      logger.info(
        { queue: this.queueName, jobId: job._id },
        `[MongoWorker] ✅ Job completed`,
      );
    } catch (err: any) {
      const attempts = job.attempts + 1;
      const isExhausted = attempts >= job.maxAttempts;

      // Exponential backoff: delay = baseBackoffMs * 2^attempts
      const backoffMs = this.baseBackoffMs * 2 ** attempts;
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
        logger.error(
          {
            queue: this.queueName,
            jobId: job._id,
            error: err.message,
            attempts,
          },
          `[MongoWorker] ❌ Job permanently failed`,
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
        logger.warn(
          {
            queue: this.queueName,
            jobId: job._id,
            attempt: attempts,
            runAt: runAt.toISOString(),
          },
          `[MongoWorker] ⚠️ Job failed, retrying`,
        );
      }
    }
  }
}
