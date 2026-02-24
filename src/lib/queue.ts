import { MongoQueue } from "./mongoQueue/index.ts";
import type { AddJobOptions } from "./mongoQueue/types.ts";

const workflowQueue = MongoQueue.getQueue("whatsapp-workflow");

/**
 * @Enqueue a workflow job.
 * @borrows Enqueue a workflow job.
 *
 * @param {scheduleWorkflow} - Enqueue a workflow job.
 */
export const scheduleWorkflow = async (
  data: Record<string, unknown>,
  delayMs: number,
) => {
  try {
    const job = await workflowQueue.add(data, {
      delayMs,
    } satisfies AddJobOptions);
    return { id: job._id };
  } catch (err: any) {
    console.error(`[MongoQueue] Failed to schedule workflow:`, err.message);
    throw err;
  }
};
