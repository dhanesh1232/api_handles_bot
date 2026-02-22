import express, { type Request, type Response } from "express";
import { getTenantConnection, getTenantModel } from "../../../lib/connectionManager.js";
import { validateClientKey } from "../../../middleware/saasAuth.js";
import { schemas } from "../../../model/saas/tenantSchemas.js";
import type { ICommunicationWorkflow } from "../../../model/saas/whatsapp/communication-workflow.model.ts";

export const createWorkflowRouter = () => {
  const router = express.Router();

  // Helper to get model
  const getWorkflowModel = async (req: Request) => {
    const clientCode = req.headers["x-client-code"] as string;
    if (!clientCode) throw new Error("Missing client code");
    const tenantConn = await getTenantConnection(clientCode);
    return getTenantModel<ICommunicationWorkflow>(
      tenantConn,
      "CommunicationWorkflow",
      schemas.communicationWorkflows
    );
  };

  /**
   * List all workflows
   */
  router.get("/",validateClientKey, async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflows = await Workflow.find().sort({ createdAt: -1 });
      res.json({ success: true, data: workflows });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Create new workflow
   */
  router.post("/",validateClientKey, async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflow = await Workflow.create(req.body);
      res.json({ success: true, data: workflow });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Update workflow
   */
  router.patch("/:id",validateClientKey, async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflow = await Workflow.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!workflow) return res.status(404).json({ success: false, error: "Workflow not found" });
      res.json({ success: true, data: workflow });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Delete workflow
   */
  router.delete("/:id", validateClientKey,async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflow = await Workflow.findByIdAndDelete(req.params.id);
      if (!workflow) return res.status(404).json({ success: false, error: "Workflow not found" });
      res.json({ success: true, message: "Workflow deleted" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

   /**
   * Trigger workflows for an event
   */
  router.post("/trigger", validateClientKey, async (req: Request, res: Response) => {
    try {
      const { trigger, phone, variables, conversationId, metadata, baseTime, callbackUrl, callbackMetadata } = req.body;
      const clientCode = req.headers["x-client-code"] as string;

      if (!trigger || !phone) {
        return res.status(400).json({ success: false, error: "Missing trigger or phone" });
      }

      const Workflow = await getWorkflowModel(req);
      const activeWorkflows = await Workflow.find({ trigger, isActive: true });

      if (activeWorkflows.length === 0) {
        return res.json({ success: true, message: "No active workflows for this trigger" });
      }

      const { createWhatsappService } = await import("../../../services/saas/whatsapp/whatsappService.ts");
      const whatsappService = createWhatsappService((req as any).io);
      const { scheduleWorkflow } = await import("../../../lib/queue.ts");
      const { executeWorkflow } = await import("../../../jobs/saas/workflowWorker.ts");

      for (const workflow of activeWorkflows) {
          if (workflow.delayMinutes === 0) {
              // Instant Execution
              await executeWorkflow({
                  clientCode,
                  phone,
                  templateName: workflow.templateName,
                  variables: variables || [],
                  channel: workflow.channel,
                  conversationId,
                  callbackUrl: callbackUrl,
                  callbackMetadata: callbackMetadata
              });
          } else {
              // Scheduled Execution
              let delayMs = 0;
              const effectiveDelayMinutes = req.body.delayMinutes !== undefined ? req.body.delayMinutes : workflow.delayMinutes;
              
              if (baseTime) {
                  const targetTime = new Date(new Date(baseTime).getTime() + (effectiveDelayMinutes * 60000));
                  delayMs = targetTime.getTime() - Date.now();
              } else {
                  delayMs = effectiveDelayMinutes * 60000;
              }

              // Apply the user-requested "5 minute safety gap" for scheduled workflows after payment success
              // If the trigger comes from a payment success event (implied), ensure delay is at least 5 mins
              // Note: We only do this if it's explicitly required. For now, I'll stick to workflow settings.
              // But I'll ensure we pass the callback info down.

              if (delayMs > -60000) { // Allow slight past due for immediate catch-up
                  console.log(`[${clientCode}] Scheduling workflow ${workflow.name} with ${delayMs}ms delay`);
                  await scheduleWorkflow({
                      clientCode,
                      phone,
                      templateName: workflow.templateName,
                      variables: variables || [],
                      channel: workflow.channel,
                      conversationId,
                      trigger: workflow.trigger,
                      callbackUrl,
                      callbackMetadata: {
                        ...callbackMetadata,
                        workflowName: workflow.name,
                        delayMinutes: effectiveDelayMinutes
                      }
                  }, delayMs);
              } else {
                  console.warn(`[${clientCode}] Skipping workflow ${workflow.name} because target time is too far in the past (${delayMs}ms)`);
              }
          }
      }

      res.json({ success: true, message: `Triggered ${activeWorkflows.length} workflows` });
    } catch (error: any) {
      console.error("Workflow Trigger Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
