/**
 * @module Jobs/SaaS/CrmWorker
 * @responsibility Industrial-grade asynchronous task processor for the CRM engine.
 *
 * **WHY THIS EXISTS:**
 * Some CRM operations (like bulk scoring or template syncing) are too heavy for the main request-response cycle.
 * The `crmWorker` offloads these to a background process using BullMQ/Redis (via ErixJobs abstractions).
 *
 * **WORKING PROCESS:**
 * 1. Listening: Polls the `crm` Redis queue for pending jobs.
 * 2. Dispatching: Uses `JobRegistry` to find the correct `JobHandler` for the given `type`.
 * 3. Execution: Passes `clientCode` and `payload` to the handler's `handle()` method.
 * 4. IO Integration: Provides a global `Socket.io` reference for handlers to emit real-time UI updates.
 *
 * **EDGE CASES:**
 * - Handler Failure: If a handler throws, the job is marked as failed and retried automatically with exponential backoff.
 * - Missing Handler: Logs a warning and fails the job to prevent silent data loss.
 */

import { ErixJobs } from "@lib/erixJobs/index";
import { ErixWorkers } from "@lib/erixJobs/worker";
import { logger } from "@lib/logger";
import { JobRegistry } from "./jobRegistry";

// ─── Exported queue singleton ─────────────────────────────────────────────────
export const crmQueue = ErixJobs.getQueue("crm");

// ─── Socket.io ref ───────────────────────────────────────────────────────────
let _globalIo: any = null;
export const registerCrmIo = (io: any): void => {
  _globalIo = io;
  (global as any).io = io; // Ensure global availability for handlers
};

// ─── Processor ────────────────────────────────────────────────────────────────
const processCrmJob = async (job: IJob): Promise<void> => {
  const { clientCode, type, payload } = job.data as any;

  if (!clientCode || !type) {
    logger.error(
      { jobId: job._id },
      "[ErixWorker] Job missing clientCode or type",
    );
    throw new Error(`[ErixWorker] Job ${job._id} missing clientCode or type`);
  }

  const handler = JobRegistry.getHandler(type);
  if (!handler) {
    logger.warn(
      { type },
      "[ErixWorker] Unknown job type, no handler registered",
    );
    throw new Error(`[ErixWorker] Unknown job type: ${type}`);
  }

  try {
    await handler.handle(clientCode, payload, job);
  } catch (err: any) {
    logger.error(
      { err, type, clientCode },
      "[ErixWorker] Handler execution failed",
    );
    throw err; // ErixWorkers will handle retries based on backoff
  }
};

// ─── Worker factory ───────────────────────────────────────────────────────────
export const startCrmWorker = (): ErixWorkers => {
  const worker = new ErixWorkers("crm", processCrmJob, {
    concurrency: 50,
    pollIntervalMs: 1000,
    maxJobsPerSecond: 50,
    baseBackoffMs: 10_000,
  });
  worker.start();
  logger.info(
    { queue: "crm", concurrency: 50, rateLimit: 50 },
    "[ErixWorker] ✅ Started with JobRegistry",
  );
  return worker;
};
