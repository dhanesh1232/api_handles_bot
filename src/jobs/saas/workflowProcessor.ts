import type { JobDocument } from "@lib/erixJobs/types";
import { ErixWorkers } from "@lib/erixJobs/worker";
import { executeWorkflow } from "./workflowWorker.ts";

/**
 * Starts the Erix-branded workflow worker.
 * Replaces the previous node-cron polling loop.
 *
 * - Polls the central "services" DB every 10 seconds
 * - Processes up to 3 jobs concurrently
 * - Auto-retries failed jobs with exponential backoff (up to 3 attempts)
 */
export const startWorkflowProcessor = () => {
  const worker = new ErixWorkers(
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
