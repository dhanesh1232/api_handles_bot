import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import Job from "@models/queue/job.model";

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
   *
   * @param clientCode - The client code for tenant isolation.
   * @param data - The data to be stored in the job.
   * @param opts - Options for the job.
   * @returns {Promise<IJob>}
   */
  async add(
    clientCode: string,
    data: Record<string, unknown>,
    opts: AddJobOptions = {},
  ) {
    await dbConnect("services");

    const {
      delayMs = 0,
      priority = 5,
      maxAttempts = 3,
      runAt: optRunAt,
    } = opts;
    const runAt = optRunAt || new Date(Date.now() + Math.max(0, delayMs));

    const job = await Job.create({
      clientCode,
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
