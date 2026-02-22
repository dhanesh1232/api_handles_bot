import { schemas } from "../model/saas/tenantSchemas.js";
import { getTenantConnection, getTenantModel } from "./connectionManager.js";

/**
 * MongoDB-based Scheduler (Free Alternative)
 * This replaces BullMQ/Redis to avoid extra costs and infrastructure.
 */
export const scheduleWorkflow = async (data: any, delayMs: number) => {
  const { clientCode } = data;
  const targetDate = new Date(Date.now() + Math.max(0, delayMs));

  try {
    const tenantConn = await getTenantConnection(clientCode);
    const ScheduledWorkflow = getTenantModel(
      tenantConn, 
      "ScheduledWorkflow", 
      schemas.scheduledWorkflows
    );

    const doc = await ScheduledWorkflow.create({
      ...data,
      scheduledFor: targetDate,
      status: "pending",
      callbackUrl: data.callbackUrl,
      callbackMetadata: data.callbackMetadata
    });

    console.log(`[MongoQueue] Scheduled workflow for ${clientCode} at ${targetDate.toISOString()}`);
    return { id: doc._id };
  } catch (err: any) {
    console.error(`[MongoQueue] Failed to schedule:`, err.message);
    
    // Emergency In-memory fallback if DB is unreachable
    if (delayMs > 0) {
      console.log(`[MongoQueue Fallback] Using In-Memory fallback for delay ${delayMs}ms`);
      setTimeout(async () => {
        try {
          const { executeWorkflow } = await import("../jobs/saas/workflowWorker.ts");
          await executeWorkflow(data);
        } catch (e: any) {
          console.error(`[Fallback] Execution failed:`, e.message);
        }
      }, Math.max(0, delayMs));
    }
    
    return { id: `fallback-${Date.now()}` };
  }
};
