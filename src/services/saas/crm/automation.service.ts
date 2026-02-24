/**
 * automationService.ts
 * Finds matching automation rules and executes their actions.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import mongoose, { FilterQuery } from "mongoose";
import { getCrmModels } from "../../../lib/tenant/getCrmModels.ts";
import { logActivity } from "./activity.service.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutomationContext {
  trigger: IAutomationRule["trigger"];
  lead: ILead;
  stageId?: string;
  tagName?: string;
  score?: number;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export const runAutomations = async (
  clientCode: string,
  ctx: AutomationContext,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);

  const ruleQuery: FilterQuery<IAutomationRule> = {
    clientCode,
    trigger: ctx.trigger,
    isActive: true,
  };
  if (ctx.stageId)
    ruleQuery["triggerConfig.stageId"] = new mongoose.Types.ObjectId(
      ctx.stageId,
    );
  if (ctx.tagName) ruleQuery["triggerConfig.tagName"] = ctx.tagName;
  if (ctx.trigger === "score_above" && ctx.score !== undefined)
    ruleQuery["triggerConfig.scoreThreshold"] = { $lte: ctx.score };
  if (ctx.trigger === "score_below" && ctx.score !== undefined)
    ruleQuery["triggerConfig.scoreThreshold"] = { $gte: ctx.score };

  const rules = await AutomationRule.find(ruleQuery);
  if (rules.length === 0) return;

  await Promise.allSettled(
    rules.map((rule) => executeRule(clientCode, rule, ctx)),
  );
};

// ─── Execute a single rule ────────────────────────────────────────────────────

const executeRule = async (
  clientCode: string,
  rule: IAutomationRule,
  ctx: AutomationContext,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);

  if (rule.condition && !evaluateCondition(rule.condition, ctx.lead)) return;

  for (const action of rule.actions) {
    if (action.delayMinutes === 0) {
      await executeAction(clientCode, action, ctx.lead);
    } else {
      await enqueueDelayedAction(
        clientCode,
        action,
        ctx.lead,
        (rule as any)._id.toString(),
      );
    }
  }

  await AutomationRule.updateOne(
    { _id: (rule as any)._id },
    { $inc: { executionCount: 1 }, $set: { lastExecutedAt: new Date() } },
  );

  await logActivity(clientCode, {
    leadId: ctx.lead._id.toString(),
    type: "automation_triggered",
    title: `Automation: "${rule.name}"`,
    body: `Triggered by: ${rule.trigger}. Actions: ${rule.actions.map((a) => a.type).join(", ")}`,
    metadata: { ruleId: (rule as any)._id.toString(), ruleName: rule.name },
    performedBy: "system",
  });
};

// ─── Execute one action immediately ──────────────────────────────────────────

const executeAction = async (
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
): Promise<void> => {
  switch (action.type) {
    case "send_whatsapp": {
      const { createWhatsappService } =
        await import("../whatsapp/whatsappService.ts");
      const service = createWhatsappService(null as any);
      const cfg = action.config as {
        templateName: string;
        variables?: string[];
      };
      await service.sendOutboundMessage(
        clientCode,
        "",
        undefined,
        undefined,
        undefined,
        "automation",
        cfg.templateName,
        "en_US",
        cfg.variables ?? [],
      );
      break;
    }
    case "send_email": {
      const { createEmailService } = await import("../mail/emailService.ts");
      const service = createEmailService();
      const cfg = action.config as { subject: string; htmlBody: string };
      await service.sendEmail(clientCode, {
        to: lead.email ?? "",
        subject: cfg.subject,
        html: cfg.htmlBody,
      });
      break;
    }
    case "move_stage": {
      const { moveLead } = await import("./lead.service.ts");
      const cfg = action.config as { stageId: string };
      await moveLead(
        clientCode,
        lead._id.toString(),
        cfg.stageId,
        "automation",
      );
      break;
    }
    case "assign_to": {
      const { Lead } = await getCrmModels(clientCode);
      const assignTo = (action.config as { assignTo: string }).assignTo;
      await Lead.updateOne(
        { _id: lead._id, clientCode },
        { $set: { assignedTo: assignTo } },
      );
      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "lead_assigned",
        title: `Assigned to ${assignTo}`,
        performedBy: "automation",
      });
      break;
    }
    case "add_tag": {
      const { updateTags } = await import("./lead.service.ts");
      await updateTags(
        clientCode,
        lead._id.toString(),
        [(action.config as { tag: string }).tag],
        [],
      );
      break;
    }
    case "remove_tag": {
      const { updateTags } = await import("./lead.service.ts");
      await updateTags(
        clientCode,
        lead._id.toString(),
        [],
        [(action.config as { tag: string }).tag],
      );
      break;
    }
    case "webhook_notify": {
      const axios = (await import("axios")).default;
      const cfg = action.config as { callbackUrl: string; event: string };
      try {
        await axios.post(cfg.callbackUrl, {
          event: cfg.event ?? "crm.automation_triggered",
          leadId: lead._id.toString(),
          phone: lead.phone,
          metadata: lead.metadata,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error("CRM Webhook failed:", (err as Error).message);
      }
      break;
    }
    case "create_meeting": {
      const { createGoogleMeetService } =
        await import("../googleMeetService.ts");
      const service = createGoogleMeetService();
      await service.createMeeting(clientCode, {
        summary: `Meeting with ${lead.firstName}`,
        attendees: lead.email ? [lead.email] : [],
      });
      break;
    }
  }
};

// ─── Enqueue delayed action ───────────────────────────────────────────────────

const enqueueDelayedAction = async (
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  ruleId: string,
): Promise<void> => {
  const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");
  await crmQueue.add(
    {
      clientCode,
      type: "crm.automation_action",
      payload: {
        actionType: action.type,
        actionConfig: action.config,
        leadId: lead._id.toString(),
        ruleId,
      },
    },
    { delayMs: action.delayMinutes * 60 * 1000 },
  );
};

// ─── Condition evaluator ──────────────────────────────────────────────────────

function evaluateCondition(
  condition: IAutomationCondition,
  lead: ILead,
): boolean {
  if (!condition) return true;
  const value = condition.field
    .split(".")
    .reduce(
      (obj: any, key: string) =>
        obj && typeof obj === "object" ? obj[key] : undefined,
      lead as any,
    );
  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "gt":
      return Number(value) > Number(condition.value);
    case "gte":
      return Number(value) >= Number(condition.value);
    case "lt":
      return Number(value) < Number(condition.value);
    case "lte":
      return Number(value) <= Number(condition.value);
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.includes(value as string)
      );
    case "contains":
      return (
        Array.isArray(value) &&
        (value as string[]).includes(condition.value as string)
      );
    default:
      return true;
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const getRules = async (
  clientCode: string,
): Promise<IAutomationRule[]> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  return AutomationRule.find({ clientCode }).sort({ createdAt: -1 });
};

export const createRule = async (
  clientCode: string,
  input: Omit<
    IAutomationRule,
    | "_id"
    | "clientCode"
    | "executionCount"
    | "lastExecutedAt"
    | "createdAt"
    | "updatedAt"
  >,
): Promise<IAutomationRule> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  return AutomationRule.create({ clientCode, ...input });
};

export const updateRule = async (
  clientCode: string,
  ruleId: string,
  updates: Partial<IAutomationRule>,
): Promise<IAutomationRule | null> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  return AutomationRule.findOneAndUpdate(
    { _id: ruleId, clientCode },
    { $set: updates },
    { new: true },
  );
};

export const deleteRule = async (
  clientCode: string,
  ruleId: string,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  await AutomationRule.deleteOne({ _id: ruleId, clientCode });
};

export const toggleRule = async (
  clientCode: string,
  ruleId: string,
): Promise<IAutomationRule | null> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  const rule = await AutomationRule.findOne({ _id: ruleId, clientCode });
  if (!rule) return null;
  return AutomationRule.findByIdAndUpdate(
    ruleId,
    { $set: { isActive: !rule.isActive } },
    { new: true },
  );
};

export const testRule = async (
  clientCode: string,
  ruleId: string,
  leadId: string,
): Promise<{
  passed: boolean;
  conditionResult: boolean;
  actionsWouldRun: string[];
}> => {
  const { AutomationRule, Lead } = await getCrmModels(clientCode);
  const [rule, lead] = await Promise.all([
    AutomationRule.findOne({ _id: ruleId, clientCode }),
    Lead.findOne({ _id: leadId, clientCode }),
  ]);
  if (!rule || !lead) throw new Error("Rule or lead not found");
  const conditionResult = rule.condition
    ? evaluateCondition(rule.condition, lead as any)
    : true;
  return {
    passed: conditionResult,
    conditionResult,
    actionsWouldRun: conditionResult ? rule.actions.map((a) => a.type) : [],
  };
};
