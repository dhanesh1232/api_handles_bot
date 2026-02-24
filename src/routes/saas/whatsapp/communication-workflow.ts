import express, { type Request, type Response } from "express";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { schemas } from "../../../model/saas/tenantSchemas.ts";
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
      schemas.communicationWorkflows,
    );
  };

  /**
   * @List all workflows
   * @borrows List all workflows
   *
   * @param {listAllWorkflows} - List all workflows
   */
  router.get("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflows = await Workflow.find().sort({ createdAt: -1 });
      res.json({ success: true, data: workflows });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @Create new workflow
   * @borrows Create new workflow
   *
   * @param {createNewWorkflow} - Create new workflow
   */
  router.post("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const Workflow = await getWorkflowModel(req);
      const workflow = await Workflow.create(req.body);
      res.json({ success: true, data: workflow });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @Update workflow
   * @borrows Update workflow
   *
   * @param {updateWorkflow} - Update workflow
   */
  router.patch(
    "/:id",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const Workflow = await getWorkflowModel(req);
        const workflow = await Workflow.findByIdAndUpdate(
          req.params.id,
          req.body,
          { new: true },
        );
        if (!workflow)
          return res
            .status(404)
            .json({ success: false, error: "Workflow not found" });
        res.json({ success: true, data: workflow });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    },
  );

  /**
   * Delete workflow
   */
  router.delete(
    "/:id",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const Workflow = await getWorkflowModel(req);
        const workflow = await Workflow.findByIdAndDelete(req.params.id);
        if (!workflow)
          return res
            .status(404)
            .json({ success: false, error: "Workflow not found" });
        res.json({ success: true, message: "Workflow deleted" });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    },
  );

  /**
   * Trigger workflows for an event (Supports single object or array for batch processing)
   */
  router.post(
    "/trigger",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const clientCode = req.headers["x-client-code"] as string;
        const Workflow = await getWorkflowModel(req);
        const { scheduleWorkflow } = await import("../../../lib/queue.ts");

        const processSingleTrigger = async (payload: any) => {
          const {
            trigger,
            phone,
            variables,
            conversationId,
            baseTime,
            callbackUrl,
            callbackMetadata,
          } = payload;

          if (!trigger || !phone) {
            throw new Error("Missing trigger or phone in payload");
          }

          const activeWorkflows = await Workflow.find({
            trigger,
            isActive: true,
          });

          for (const workflow of activeWorkflows) {
            let delayMs = 0;
            const effectiveDelayMinutes =
              payload.delayMinutes !== undefined
                ? payload.delayMinutes
                : workflow.delayMinutes;

            if (baseTime) {
              const targetTime = new Date(
                new Date(baseTime).getTime() + effectiveDelayMinutes * 60000,
              );
              delayMs = targetTime.getTime() - Date.now();
            } else {
              delayMs = effectiveDelayMinutes * 60000;
            }

            const finalDelayMs = Math.max(0, delayMs);

            console.log(
              `[${clientCode}] Scheduling workflow ${workflow.name} with ${finalDelayMs}ms delay`,
            );

            await scheduleWorkflow(
              {
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
                  delayMinutes: effectiveDelayMinutes,
                },
              },
              finalDelayMs,
            );
          }
          return activeWorkflows.length;
        };

        const payloads = Array.isArray(req.body) ? req.body : [req.body];
        let totalTriggered = 0;

        for (const payload of payloads) {
          totalTriggered += await processSingleTrigger(payload);
        }

        res.json({
          success: true,
          message: `Triggered ${totalTriggered} workflows across ${payloads.length} events`,
        });
      } catch (error: any) {
        console.error("Workflow Trigger Error:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    },
  );

  return router;
};
