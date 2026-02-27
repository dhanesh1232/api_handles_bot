/**
 * automationService.ts
 * Finds matching automation rules and executes their actions.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import mongoose from "mongoose";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { logActivity } from "./activity.service.ts";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { ConversationSchema } from "../../../model/saas/tenant.schemas.ts";
import type { IConversation } from "../../../model/saas/whatsapp/conversation.model.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutomationContext {
  trigger: IAutomationRule["trigger"];
  lead: ILead;
  stageId?: string;
  tagName?: string;
  score?: number;
  /** Extra key-value pairs from external events (e.g. { name: "Ravi", time: "3pm" }) */
  variables?: Record<string, string>;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export const runAutomations = async (
  clientCode: string,
  ctx: AutomationContext,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);

  const ruleQuery: Record<string, any> = {
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

  console.log(
    `[automationService] Triggering rule: "${rule.name}" for lead: ${ctx.lead._id}`,
  );

  for (const action of rule.actions) {
    // Enqueue ALL actions as jobs to ensure persistence and background processing
    await enqueueDelayedAction(
      clientCode,
      action,
      ctx.lead,
      (rule as any)._id.toString(),
      ctx.variables,
    );
  }

  const updateRes = await AutomationRule.updateOne(
    { _id: (rule as any)._id },
    { $inc: { executionCount: 1 }, $set: { lastExecutedAt: new Date() } },
  );
  console.log(`[automationService] Rule execution count updated:`, updateRes);

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

export const executeAction = async (
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  ctx?: AutomationContext,
): Promise<void> => {
  // Resolve placeholders in config strings
  const config = resolvePlaceholders(action.config || {}, lead, ctx?.variables);

  switch (action.type) {
    case "send_whatsapp": {
      const { createWhatsappService } =
        await import("../whatsapp/whatsapp.service.ts");
      // Use global.io if available, or fall back to null
      const service = createWhatsappService((global as any).io);
      const cfg = config as {
        templateName: string;
        variables?: string[];
        phone?: string; // Potential override
      };

      const phone = cfg.phone || lead.phone;
      if (!phone) {
        console.error(
          "❌ [automationService] Cannot send WhatsApp: Lead has no phone",
        );
        return;
      }

      // Resolve or create conversation in tenant DB
      const tenantConn = await getTenantConnection(clientCode);
      const Conversation = getTenantModel<IConversation>(
        tenantConn,
        "Conversation",
        ConversationSchema,
      );

      let conv = await Conversation.findOne({ phone });
      console.log(
        `[automationService] Searching for conversation with phone: ${phone}. Found: ${conv?._id}`,
      );

      if (!conv) {
        conv = await Conversation.create({
          phone,
          userName: lead.firstName || phone,
          status: "open",
          channel: "whatsapp",
          unreadCount: 0,
          leadId: lead._id,
        });
        console.log(
          `[automationService] Created new conversation: ${conv._id}`,
        );
      }

      await service.sendOutboundMessage(
        clientCode,
        conv._id.toString(),
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
      const { createEmailService } = await import("../mail/email.service.ts");
      const service = createEmailService();
      const cfg = config as { subject: string; htmlBody: string };
      await service.sendEmail(clientCode, {
        to: lead.email ?? "",
        subject: cfg.subject,
        html: cfg.htmlBody,
      });
      break;
    }
    case "move_stage": {
      const { moveLead } = await import("./lead.service.ts");
      const cfg = config as { stageId: string };
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
      const assignTo = (config as { assignTo: string }).assignTo;
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
        [(config as { tag: string }).tag],
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
        [(config as { tag: string }).tag],
      );
      break;
    }
    case "webhook_notify": {
      const axios = (await import("axios")).default;
      const cfg = config as { callbackUrl: string; event: string };
      try {
        await axios.post(cfg.callbackUrl, {
          event: cfg.event ?? "crm.automation_triggered",
          leadId: lead._id.toString(),
          phone: lead.phone,
          metadata: lead.metadata,
          timestamp: new Date().toISOString(),
          variables: ctx?.variables,
        });
      } catch (err) {
        console.error("CRM Webhook failed:", (err as Error).message);
      }
      break;
    }
    case "create_meeting": {
      const { createGoogleMeetService } =
        await import("../meet/google.meet.service.ts");
      const service = createGoogleMeetService();
      const cfg = config as { summary?: string };
      await service.createMeeting(clientCode, {
        summary: cfg.summary || `Meeting with ${lead.firstName}`,
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
  variables?: Record<string, string>,
): Promise<void> => {
  const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");

  // Merge context into actionConfig
  const actionConfig: Record<string, unknown> = {
    ...(action.config as Record<string, unknown>),
    phone: (action.config as any).phone ?? lead.phone,
    email: (action.config as any).email ?? lead.email ?? "",
  };

  // Resolve any placeholders BEFORE enqueuing so the job document stores final values
  const resolvedConfig = resolvePlaceholders(actionConfig, lead, variables);

  await crmQueue.add(
    {
      clientCode,
      type: "crm.automation_action",
      payload: {
        actionType: action.type,
        actionConfig: resolvedConfig,
        leadId: lead._id.toString(),
        ruleId,
        ctxVariables: variables, // Keep as fallback/context
      },
    },
    { delayMs: action.delayMinutes * 60 * 1000 },
  );
};

// ─── Placeholder Resolver ─────────────────────────────────────────────────────

/**
 * Replaces {{vars.key}} with values from variables object,
 * and {{lead.field}} with values from lead object.
 */
function resolvePlaceholders(
  obj: any,
  lead: ILead,
  variables?: Record<string, string>,
): any {
  const str = JSON.stringify(obj);
  const resolved = str.replace(
    /\{\{(vars|lead)\.([^}]+)\}\}/g,
    (match, type, key) => {
      if (type === "vars") {
        return variables?.[key] ?? match;
      }
      if (type === "lead") {
        // Handle nested lead fields (metadata.city)
        return (
          key.split(".").reduce((o: any, i: string) => (o as any)?.[i], lead) ??
          match
        ).toString();
      }
      return match;
    },
  );
  return JSON.parse(resolved);
}

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
    { returnDocument: "after" },
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
    { returnDocument: "after" },
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
