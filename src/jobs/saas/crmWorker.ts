/**
 * crmWorker.ts
 * Unified async job processor for all CRM actions.
 *
 * Queue name: "crm"
 * Started in server.ts alongside the whatsapp-workflow worker.
 *
 * Job types handled:
 *   crm.automation_action  — delayed automation step (send_whatsapp, send_email, move_stage, assign_to, add_tag, webhook_notify)
 *   crm.automation_event   — delayed external trigger (fires runAutomations after a delay)
 *   crm.email              — transactional or bulk email send
 *   crm.meeting            — async Google Meet creation → fires onMeetingCreated hook
 *   crm.reminder           — appointment/follow-up WhatsApp reminder
 *   crm.score_refresh      — background lead score recalculation
 *   crm.webhook_notify     — fire an HTTP callback to client's server
 */

import { ErixJobs } from "@lib/erixJobs/index";
import { ErixWorkers } from "@lib/erixJobs/worker";
import { logger } from "@lib/logger";
import type { IJob } from "@models/queue/job.model";
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
