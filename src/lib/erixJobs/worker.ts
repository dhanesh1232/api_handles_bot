/**
 * @file src/lib/erixJobs/worker.ts
 * @module ErixJobs
 * @responsibility Distributed job worker with tenant-fairness, rate-limiting, and backoff logic.
 * @dependencies @lib/config, @lib/logger, @models/queue/job.model
 */

import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import Job from "@models/queue/job.model";

/**
 * ErixWorkers — Resilient job processor.
 *
 * **ARCHITECTURE:**
 * - Uses a "Polling with Fairness" strategy to prevent single-tenant starvation.
 * - Implements distributed locking via Mongoose `findOneAndUpdate`.
 * - Supports exponential backoff for failed jobs.
 * - Enforces global and per-worker rate limits.
 *
 * @class ErixWorkers
 */
export class ErixWorkers {
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
      `[ErixWorkers] Starting`,
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
      logger.info({ queue: this.queueName }, `[ErixWorkers] Stopped.`);
    }
  }

  /** Cache for client service configs to reduce DB pressure. clientCode -> { limit: number, expires: number } */
  private static configCache = new Map<
    string,
    { limit: number; expires: number }
  >();
  private static CACHE_TTL = 10_000; // 10 seconds

  /**
   * Core execution loop for the worker.
   *
   * **WORKING PROCESS:**
   * 1. Connects to the primary services database.
   * 2. Calculates available concurrency slots based on local running jobs and global rate limits.
   * 3. Calculates "Fairness Points" (active jobs per client) to identify the lead-starving tenants.
   * 4. Claims the next eligible job using an atomic sort-and-update query.
   * 5. Spawns an asynchronous job execution block and recurses to fill available slots.
   *
   * @private
   * @returns {Promise<void>}
   * @edge_case Automatically skips tenants that have reached their service-specific concurrency limits.
   */
  private async poll() {
    if (this.isStopping) return;

    await dbConnect("services");
    const { ClientServiceConfig } = await import("@models/clients/config");

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

    if (available <= 0) return;

    const nowDate = new Date();

    // 1. Get current active counts per client for this queue
    const activeStats = await Job.aggregate([
      { $match: { queue: this.queueName, status: "active" } },
      { $group: { _id: "$clientCode", count: { $sum: 1 } } },
    ]);

    const clientActiveCounts = new Map<string, number>();
    for (const stat of activeStats) {
      clientActiveCounts.set(stat._id, stat.count);
    }

    // 2. Identify saturated clients
    const saturatedClients: string[] = [];

    // We only need to check limits for clients that have active jobs or are in the cache
    const clientsToCheck = Array.from(clientActiveCounts.keys());

    for (const clientCode of clientsToCheck) {
      let config = ErixWorkers.configCache.get(clientCode);
      if (!config || config.expires < now) {
        const dbConfig = await ClientServiceConfig.findOne({
          clientCode,
        }).lean();
        const limit = dbConfig?.workers?.maxParallelTasks ?? 2;
        config = { limit, expires: now + ErixWorkers.CACHE_TTL };
        ErixWorkers.configCache.set(clientCode, config);
      }

      const active = clientActiveCounts.get(clientCode) || 0;
      if (active >= config.limit) {
        saturatedClients.push(clientCode);
      }
    }

    // 3. Claim jobs, avoiding saturated clients
    const claimed: IJob[] = [];

    for (let i = 0; i < available; i++) {
      const job = await Job.findOneAndUpdate(
        {
          queue: this.queueName,
          status: "waiting",
          runAt: { $lte: nowDate },
          clientCode: { $nin: saturatedClients },
        },
        { $set: { status: "active" } },
        {
          returnDocument: "after",
          sort: { priority: 1, runAt: 1 },
        },
      ).lean<IJob>();

      if (!job) break;

      claimed.push(job);

      // Update local tracking for next iteration of this loop
      const currentCount = (clientActiveCounts.get(job.clientCode) || 0) + 1;
      clientActiveCounts.set(job.clientCode, currentCount);

      // Check if this client just became saturated
      let config = ErixWorkers.configCache.get(job.clientCode);
      if (!config || config.expires < now) {
        const dbConfig = await ClientServiceConfig.findOne({
          clientCode: job.clientCode,
        }).lean();
        const limit = dbConfig?.workers?.maxParallelTasks ?? 2;
        config = { limit, expires: now + ErixWorkers.CACHE_TTL };
        ErixWorkers.configCache.set(job.clientCode, config);
      }

      if (currentCount >= config.limit) {
        saturatedClients.push(job.clientCode);
      }
    }

    for (const job of claimed) {
      this.running++;
      this.jobsStartedInLastSecond++;
      this.execute(job).finally(() => this.running--);
    }
  }

  /**
   * Executes a single claimed job.
   *
   * **WORKING PROCESS:**
   * 1. Invokes the provided processor function.
   * 2. Success: Marks job as "completed" and timestamps it.
   * 3. Failure:
   *    - Increments attempt count.
   *    - Calculates exponential backoff: `baseBackoffMs * 2 ^ attempts`.
   *    - Re-queues as "waiting" with a future `runAt` time.
   *    - If `maxAttempts` is reached, marks as "failed" permanently.
   *
   * @param {IJob} job - The job document to process.
   * @returns {Promise<void>}
   * @edge_case Implements resilient retries to handle transient failures (API timeouts, DB locks).
   */
  private async execute(job: IJob) {
    try {
      await this.processor(job);

      await Job.findByIdAndUpdate(job._id, {
        $set: { status: "completed", completedAt: new Date() },
      });

      logger.info(
        { queue: this.queueName, jobId: job._id },
        `[ErixWorkers] ✅ Job completed`,
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
          `[ErixWorkers] ❌ Job permanently failed`,
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
          `[ErixWorkers] ⚠️ Job failed, retrying`,
        );
      }
    }
  }
}
