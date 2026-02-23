import Job from "../../model/queue/job.model.js";
import { dbConnect } from "../config.js";
import type { AddJobOptions } from "./types.js";

/**
 * MongoQueue — thin wrapper for enqueuing jobs.
 * All jobs are stored in the central "services" DB.
 */
export class MongoQueue {
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

    console.log(
      `[MongoQueue:${this.queueName}] Job ${job._id} queued, runAt=${runAt.toISOString()}`,
    );
    return job;
  }

  /** Convenience static factory — same as `new MongoQueue(name)`. */
  static getQueue(name: string) {
    return new MongoQueue(name);
  }
}
