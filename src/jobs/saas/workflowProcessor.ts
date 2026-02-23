import type { JobDocument } from "../../lib/mongoQueue/types.ts";
import { MongoWorker } from "../../lib/mongoQueue/worker.ts";
import { executeWorkflow } from "./workflowWorker.ts";

/**
 * Starts the MongoDB-backed workflow worker.
 * Replaces the previous node-cron polling loop.
 *
 * - Polls the central "services" DB every 10 seconds
 * - Processes up to 3 jobs concurrently
 * - Auto-retries failed jobs with exponential backoff (up to 3 attempts)
 */
export const startWorkflowProcessor = () => {
  const worker = new MongoWorker(
    "whatsapp-workflow",
    async (job: JobDocument) => {
      await executeWorkflow(job.data as any);
    },
    {
      concurrency: 3,
      pollIntervalMs: 10_000,
      baseBackoffMs: 5_000,
    },
  );

  worker.start();
  return worker;
};
