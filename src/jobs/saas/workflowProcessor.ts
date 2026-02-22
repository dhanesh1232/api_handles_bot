import nodeCron from "node-cron";
import { getTenantConnection, getTenantModel } from "../../lib/connectionManager.js";
import { schemas } from "../../model/saas/tenantSchemas.js";
import { executeWorkflow } from "./workflowWorker.ts";

/**
 * This processor polls MongoDB every minute to find workflows that need to be sent.
 * It handles the multi-tenant architecture by scanning all active connections.
 */
export const startWorkflowProcessor = () => {
  console.log("[Processor] Starting MongoDB-based Workflow Processor (Polling every 1m)");

  nodeCron.schedule("* * * * *", async () => {
    try {
      // 1. Get all active tenant connections from the connection manager
      const { connectionCache } = await import("../../lib/connectionManager.js");
      const activeTenantCodes = Array.from(connectionCache.keys());

      if (activeTenantCodes.length === 0) return;

      for (const clientCode of activeTenantCodes) {
        try {
          const tenantConn = await getTenantConnection(clientCode);
          const ScheduledWorkflow = getTenantModel(tenantConn, "ScheduledWorkflow", schemas.scheduledWorkflows);

          // 2. Find pending workflows where scheduledFor <= now
          const now = new Date();
          const pendingWorkflows = await ScheduledWorkflow.find({
            status: "pending",
            scheduledFor: { $lte: now }
          }).limit(10); // Process in small batches

          if (pendingWorkflows.length > 0) {
            console.log(`[Processor] Processing ${pendingWorkflows.length} workflows for ${clientCode}`);
          }

          for (const workflow of pendingWorkflows) {
            try {
              // 3. Mark as processing/completed to avoid double sending
              workflow.status = "completed";
              await workflow.save();

              // 4. Execute
              await executeWorkflow(workflow);
              
              console.log(`[Processor] Successfully executed workflow ${workflow._id} for ${clientCode}`);
            } catch (err: any) {
              console.error(`[Processor] Failed workflow ${workflow._id}:`, err.message);
              workflow.status = "failed";
              workflow.error = err.message;
              workflow.attempts += 1;
              await workflow.save();
            }
          }
        } catch (err: any) {
          console.error(`[Processor] Error querying tenant ${clientCode}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[Processor] Main polling loop failed:", err.message);
    }
  });
};
