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
router.post("/events", async (req: Request, res: Response) => {
  try {
    const clientCode = req.clientCode!;
    const {
      trigger,
      phone,
      variables,
      stageId,
      tagName,
      score,
      createLeadIfMissing = false,
      leadData,
      delaySeconds = 0,
    } = req.body as {
      trigger: string;
      phone: string;
      variables?: Record<string, string>;
      stageId?: string;
      tagName?: string;
      score?: number;
      createLeadIfMissing?: boolean;
      /** Fire this trigger N seconds in the future. Default: 0 (immediate). */
      delaySeconds?: number;
      leadData?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        source?: string;
      };
    };

    if (!trigger || !phone) {
      res.status(400).json({
        success: false,
        message: "'trigger' and 'phone' are required",
      });
      return;
    }

    // Find the lead by phone
    const { getLeadByPhone, createLead } =
      await import("../../../services/saas/crm/lead.service.ts");
    let lead = await getLeadByPhone(clientCode, phone);

    // Optionally auto-create the lead if it doesn't exist
    if (!lead) {
      if (!createLeadIfMissing) {
        res.status(404).json({
          success: false,
          message: `No lead found for phone ${phone}. Pass createLeadIfMissing: true to auto-create.`,
        });
        return;
      }
      lead = await createLead(clientCode, {
        firstName: leadData?.firstName ?? phone,
        lastName: leadData?.lastName,
        email: leadData?.email,
        phone,
        source: (leadData?.source as any) ?? "other",
      });
    }

    const leadId = (lead as any)._id?.toString();

    // ── Delayed event: queue it, don't run now ──────────────────────────────
    if (delaySeconds > 0) {
      const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");
      await crmQueue.add(
        {
          clientCode,
          type: "crm.automation_event",
          payload: { trigger, leadId, phone, variables, stageId, tagName, score },
        },
        { delayMs: delaySeconds * 1000 },
      );
      res.json({
        success: true,
        leadId,
        scheduled: true,
        scheduledIn: `${delaySeconds}s`,
        message: `Trigger '${trigger}' scheduled in ${delaySeconds}s`,
      });
      return;
    }

    // ── Immediate event: fire runAutomations now ────────────────────────────
    const { runAutomations } =
      await import("../../../services/saas/crm/automation.service.ts");

    let rulesTriggered = 0;
    try {
      const { getCrmModels } =
        await import("../../../lib/tenant/get.crm.model.ts");
      const { AutomationRule } = await getCrmModels(clientCode);
      rulesTriggered = await AutomationRule.countDocuments({
        clientCode,
        trigger,
        isActive: true,
      });
    } catch {
      /* non-critical — continue */
    }

    await runAutomations(clientCode, {
      trigger: trigger as IAutomationRule["trigger"],
      lead: lead as ILead,
      stageId,
      tagName,
      score,
      variables,
    });

    res.json({
      success: true,
      leadId,
      rulesTriggered,
      message: `Trigger '${trigger}' fired — ${rulesTriggered} rule(s) matched`,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});


export default router;
