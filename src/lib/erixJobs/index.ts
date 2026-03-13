import Job from "@models/queue/job.model";
import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import type { AddJobOptions } from "./types.ts";

/**
 * ErixJobs — thin wrapper for enqueuing jobs.
 * All jobs are stored in the central "services" DB.
 */
export class ErixJobs {
  private queueName: string;

  constructor(queueName: string) {
    this.queueName = queueName;
  }

  /**
   * Add a job to the queue.
   * Returns the created job document.
   */
  async add(data: Record<string, unknown>, opts: AddJobOptions = {}) {
    await dbConnect("services");

    const { delayMs = 0, priority = 5, maxAttempts = 3 } = opts;
    const runAt = new Date(Date.now() + Math.max(0, delayMs));

    const job = await Job.create({
      queue: this.queueName,
      data,
      priority,
      runAt,
      maxAttempts,
      status: "waiting",
    });

    logger.info(
      { queue: this.queueName, jobId: job._id, runAt: runAt.toISOString() },
      `[ErixJobs] Job queued`,
    );
    return job;
  }

  /** Convenience static factory — same as `new ErixJobs(name)`. */
  static getQueue(name: string) {
    return new ErixJobs(name);
  }
}
