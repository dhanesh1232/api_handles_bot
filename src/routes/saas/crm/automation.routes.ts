/**
 * automation.routes.ts
 * CRUD + test-run for automation rules.
 * Place at: src/routes/saas/crm/automation.routes.ts
 */

import { Router, type Request, type Response } from "express";
import * as automationService from "../../../services/saas/crm/automation.service.ts";

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
 * POST /api/crm/automations/:ruleId/test
 * Dry-run a rule against a specific lead. Does NOT execute actions.
 * Body: { leadId }
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

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/crm/automations/events
 *
 * Universal event hook — the single endpoint any external client app calls
 * to fire a named automation trigger.  A client never has to know which
 * WhatsApp template, email, or stage move to run; the configured
 * AutomationRules handle all of that.
 *
 * Authentication: standard x-client-code + x-api-key (validateClientKey
 * is applied at the router mount point in server.ts).
 *
 * Body:
 *   {
 *     "trigger":            "appointment_confirmed",   // required — any trigger enum value
 *     "phone":              "+919876543210",           // required — identifies the lead
 *     "variables":          { "name": "Ravi" },        // optional — passed to action configs
 *     "createLeadIfMissing": true,                    // optional — auto-create lead if new contact
 *     "leadData": {                                   // optional — used only when creating a new lead
 *       "firstName": "Ravi",
 *       "source": "website"
 *     }
 *   }
 *
 * Example — Nirvisham fires after an appointment is confirmed:
 *   POST /api/crm/automations/events
 *   x-client-code: nirvisham
 *   { "trigger": "appointment_confirmed", "phone": "+91...", "variables": { "name": "Ravi", "time": "3 PM" } }
 *
 * Example — an e-commerce app fires after a product purchase:
 *   POST /api/crm/automations/events
 *   x-client-code: store_client
 *   { "trigger": "product_purchased", "phone": "+91...", "variables": { "product": "Plan A" }, "createLeadIfMissing": true }
 */
/**
 * POST /api/crm/automations/events
 * @deprecated — Use POST /api/saas/workflows/trigger instead.
 *
 * This endpoint is kept to avoid hard failures for any existing integrations
 * but new features (Meet, EventLog, callbacks, delayMinutes) are NOT available here.
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

    const { getTenantConnection, getTenantModel } =
      await import("../../../lib/connectionManager.ts");
    const { schemas } = await import("../../../model/saas/tenant.schemas.ts");
    const tenantConn = await getTenantConnection(clientCode);
    const SequenceEnrollment = getTenantModel<any>(
      tenantConn,
      "SequenceEnrollment",
      schemas.sequenceEnrollments,
    );

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
        .limit(Number(limit)),
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

      const { getTenantConnection, getTenantModel } =
        await import("../../../lib/connectionManager.ts");
      const { schemas } = await import("../../../model/saas/tenant.schemas.ts");
      const tenantConn = await getTenantConnection(clientCode);
      const SequenceEnrollment = getTenantModel<any>(
        tenantConn,
        "SequenceEnrollment",
        schemas.sequenceEnrollments,
      );

      const enrollment = await SequenceEnrollment.findOne({
        _id: enrollmentId,
        clientCode,
      });
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

      const { getTenantConnection, getTenantModel } =
        await import("../../../lib/connectionManager.ts");
      const { schemas } = await import("../../../model/saas/tenant.schemas.ts");
      const tenantConn = await getTenantConnection(clientCode);
      const SequenceEnrollment = getTenantModel<any>(
        tenantConn,
        "SequenceEnrollment",
        schemas.sequenceEnrollments,
      );

      const enrollment = await SequenceEnrollment.findOneAndUpdate(
        { _id: enrollmentId, ruleId, clientCode },
        { $set: { status: "paused" } },
        { new: true },
      );

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

      const { getTenantConnection, getTenantModel } =
        await import("../../../lib/connectionManager.ts");
      const { schemas } = await import("../../../model/saas/tenant.schemas.ts");
      const tenantConn = await getTenantConnection(clientCode);
      const SequenceEnrollment = getTenantModel<any>(
        tenantConn,
        "SequenceEnrollment",
        schemas.sequenceEnrollments,
      );

      const enrollment = await SequenceEnrollment.findOne({
        _id: enrollmentId,
        ruleId,
        clientCode,
      });
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
        const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");
        let delayMs = 0;
        if (
          enrollment.nextStepAt &&
          new Date(enrollment.nextStepAt).getTime() > Date.now()
        ) {
          delayMs = new Date(enrollment.nextStepAt).getTime() - Date.now();
        }

        await crmQueue.add(
          {
            clientCode,
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
