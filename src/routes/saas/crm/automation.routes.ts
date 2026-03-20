/**
 * @module Routes/CRM/Automation
 * @responsibility Management of event-driven workflows and rule-based processing.
 *
 * **GOAL:** Define, test, and manage automation rules that respond to lead activities (stage changes, score drops, etc.) with automated actions (WhatsApp, Emails).
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import { type Request, type Response, Router } from "express";
import * as automationService from "@/services/saas/crm/automation.service";

const router = Router();

/**
 * GET /api/crm/automations
 * List all rules for this client.
 */
router.get("/automations", async (req: Request, res: Response) => {
  try {
    const rules = await automationService.getRules(req.clientCode!);
    res.json({ success: true, data: rules });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/automations
 * Create a rule.
 *
 * Body example — "When lead enters Qualified stage, send WA immediately":
 * {
 *   "name": "Welcome to Qualified",
 *   "trigger": "stage_enter",
 *   "triggerConfig": { "stageId": "6789abc...", "pipelineId": "6789..." },
 *   "actions": [
 *     {
 *       "type": "send_whatsapp",
 *       "delayMinutes": 0,
 *       "config": { "templateName": "qualified_welcome", "variables": [] }
 *     }
 *   ]
 * }
 *
 * Body example — "If score drops below 30 AND source is cold_outreach, archive":
 * {
 *   "name": "Auto-archive cold dead leads",
 *   "trigger": "score_below",
 *   "triggerConfig": { "scoreThreshold": 30 },
 *   "condition": { "field": "source", "operator": "eq", "value": "cold_outreach" },
 *   "actions": [
 *     { "type": "add_tag", "delayMinutes": 0, "config": { "tag": "cold-dead" } }
 *   ]
 * }
 */
router.post("/automations", async (req: Request, res: Response) => {
  try {
    const { name, trigger, triggerConfig, condition, actions } = req.body;
    if (!name || !trigger || !actions?.length) {
      res.status(400).json({
        success: false,
        message: "name, trigger, and at least one action are required",
      });
      return;
    }
    const rule = await automationService.createRule(req.clientCode!, {
      name,
      trigger,
      triggerConfig: triggerConfig ?? {},
      condition,
      actions,
      isActive: true,
    } as Parameters<typeof automationService.createRule>[1]);
    res.status(201).json({ success: true, data: rule });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/automations/:ruleId
 * Update any fields on a rule.
 */
router.patch("/automations/:ruleId", async (req: Request, res: Response) => {
  try {
    const rule = await automationService.updateRule(
      req.clientCode!,
      req.params.ruleId as string,
      req.body,
    );
    if (!rule) {
      res.status(404).json({ success: false, message: "Rule not found" });
      return;
    }
    res.json({ success: true, data: rule });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/automations/:ruleId/toggle
 * Enable / disable a rule.
 */
router.patch(
  "/automations/:ruleId/toggle",
  async (req: Request, res: Response) => {
    try {
      const rule = await automationService.toggleRule(
        req.clientCode!,
        req.params.ruleId as string,
      );
      if (!rule) {
        res.status(404).json({ success: false, message: "Rule not found" });
        return;
      }
      res.json({ success: true, data: rule });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * DELETE /api/crm/automations/:ruleId
 */
router.delete("/automations/:ruleId", async (req: Request, res: Response) => {
  try {
    await automationService.deleteRule(
      req.clientCode!,
      req.params.ruleId as string,
    );
    res.json({ success: true, message: "Rule deleted" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * DELETE /api/crm/automations/bulk
 * Body: { ids: string[] }
 */
router.post("/automations/bulk-delete", async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ success: false, message: "ids array is required" });
    }
    await automationService.deleteRules(req.clientCode!, ids);
    res.json({ success: true, message: `${ids.length} rules deleted` });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * Automation Dry-Run / Testing.
 *
 * **GOAL:** Safely validate if an automation rule would fire for a specific lead without actually executing the side-effect actions.
 *
 * **DETAILED EXECUTION:**
 * 1. **Context Mocking**: Simulates the trigger event for the specified `leadId`.
 * 2. **Condition Engine**: Evaluates the rule's `condition` against the lead's current state.
 * 3. **Outcome Reporting**: Returns boolean `match` and evaluation metadata.
 */
router.post(
  "/automations/:ruleId/test",
  async (req: Request, res: Response) => {
    try {
      const { leadId } = req.body;
      if (!leadId) {
        res.status(400).json({ success: false, message: "leadId is required" });
        return;
      }
      const result = await automationService.testRule(
        req.clientCode!,
        req.params.ruleId as string,
        leadId,
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * Legacy Universal Event Hook.
 *
 * **GOAL:** Provide backward compatibility for older integrations firing custom events.
 *
 * **DETAILED EXECUTION:**
 * 1. **Deprecation Notice**: Returns a 301 status pointing to the new `/api/saas/workflows/trigger` endpoint.
 * 2. **Migration Metadata**: Includes a mapping of schema changes between the legacy and modern trigger formats.
 */
/**
 * POST /api/crm/automations/events
 * @deprecated — Use POST /api/saas/workflows/trigger instead.
 */
router.post("/events", (_req: Request, res: Response) => {
  res.status(301).json({
    success: false,
    message:
      "This endpoint is deprecated. Use POST /api/saas/workflows/trigger instead.",
    newEndpoint: "POST /api/saas/workflows/trigger",
    migration: {
      same: [
        "trigger",
        "phone",
        "variables",
        "createLeadIfMissing",
        "leadData",
      ],
      added: [
        "requiresMeet",
        "meetConfig",
        "callbackUrl",
        "data",
        "delayMinutes",
      ],
    },
  });
});

/**
 * GET /api/crm/automations/:ruleId/enrollments
 */
router.get("/:ruleId/enrollments", async (req: Request, res: Response) => {
  try {
    const clientCode = req.clientCode!;
    const { ruleId } = req.params;
    const { status, page = 1, limit = 20, startDate, endDate } = req.query;

    const { SequenceEnrollment } = await getCrmModels(clientCode);

    const query: any = { clientCode, ruleId };
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [enrollments, total] = await Promise.all([
      SequenceEnrollment.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      SequenceEnrollment.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: enrollments,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/automations/enrollments/:enrollmentId
 */
router.get(
  "/enrollments/:enrollmentId",
  async (req: Request, res: Response) => {
    try {
      const clientCode = req.clientCode!;
      const { enrollmentId } = req.params;

      const { SequenceEnrollment } = await getCrmModels(clientCode);

      const enrollment = await SequenceEnrollment.findOne({
        _id: enrollmentId,
        clientCode,
      }).lean();
      if (!enrollment) {
        res
          .status(404)
          .json({ success: false, message: "Enrollment not found" });
        return;
      }

      res.json({ success: true, data: enrollment });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * POST /api/crm/automations/:ruleId/enrollments/:enrollmentId/pause
 */
router.post(
  "/:ruleId/enrollments/:enrollmentId/pause",
  async (req: Request, res: Response) => {
    try {
      const clientCode = req.clientCode!;
      const { ruleId, enrollmentId } = req.params;

      const { SequenceEnrollment } = await getCrmModels(clientCode);

      const enrollment = await SequenceEnrollment.findOneAndUpdate(
        { _id: enrollmentId, ruleId, clientCode },
        { $set: { status: "paused" } },
        { returnDocument: "after" },
      ).lean();

      if (!enrollment) {
        res
          .status(404)
          .json({ success: false, message: "Enrollment not found" });
        return;
      }

      res.json({ success: true, data: enrollment });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * POST /api/crm/automations/:ruleId/enrollments/:enrollmentId/resume
 */
router.post(
  "/:ruleId/enrollments/:enrollmentId/resume",
  async (req: Request, res: Response) => {
    try {
      const clientCode = req.clientCode!;
      const { ruleId, enrollmentId } = req.params;

      const { SequenceEnrollment } = await getCrmModels(clientCode);

      const enrollment = await SequenceEnrollment.findOne({
        _id: enrollmentId,
        ruleId,
        clientCode,
      }).lean();
      if (!enrollment) {
        res
          .status(404)
          .json({ success: false, message: "Enrollment not found" });
        return;
      }

      if (enrollment.status === "paused") {
        enrollment.status = "active";
        await enrollment.save();

        // Enqueue next step
        const { crmQueue } = await import("@/jobs/saas/crmWorker");
        let delayMs = 0;
        if (
          enrollment.nextStepAt &&
          new Date(enrollment.nextStepAt).getTime() > Date.now()
        ) {
          delayMs = new Date(enrollment.nextStepAt).getTime() - Date.now();
        }

        await crmQueue.add(
          clientCode,
          {
            type: "crm.sequence_step",
            payload: {
              enrollmentId: enrollment._id.toString(),
              stepNumber: enrollment.currentStep,
            },
          },
          { delayMs },
        );
      }

      res.json({ success: true, data: enrollment });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

export default router;
