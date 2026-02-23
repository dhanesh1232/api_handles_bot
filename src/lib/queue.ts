import { MongoQueue } from "./mongoQueue/index.js";
import type { AddJobOptions } from "./mongoQueue/types.js";

const workflowQueue = MongoQueue.getQueue("whatsapp-workflow");

/**
 * Enqueue a workflow job.
 * Replaces the previous per-tenant ScheduledWorkflow.create() approach.
 * Jobs now live in the central services DB and are processor-agnostic.
 */
export const scheduleWorkflow = async (
  data: Record<string, unknown>,
  delayMs: number
) => {
  try {
    const job = await workflowQueue.add(data, { delayMs } satisfies AddJobOptions);
    return { id: job._id };
  } catch (err: any) {
    console.error(`[MongoQueue] Failed to schedule workflow:`, err.message);
    throw err;
  }
};
