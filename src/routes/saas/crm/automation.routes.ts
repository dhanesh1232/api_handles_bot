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

export default router;
