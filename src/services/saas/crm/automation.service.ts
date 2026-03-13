/**
 * automationService.ts
 * Finds matching automation rules and executes their actions.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import mongoose from "mongoose";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { getAutomationRuleRepo } from "./automation.repository";
import { ConversationSchema } from "../../../model/saas/tenant.schemas.ts";

import { normalizePhone } from "../../../utils/phone.ts";
import { createSDK } from "../../../sdk/index.ts";
import { ConditionEvaluator } from "../automation/conditionEvaluator.service.ts";
import { ActionExecutor } from "../automation/actionExecutor.service.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutomationContext {
  trigger: IAutomationRule["trigger"];
  lead: ILead;
  stageId?: string;
  tagName?: string;
  score?: number;
  /** Extra key-value pairs from external events (e.g. { name: "Ravi", time: "3pm" }) */
  variables?: Record<string, string>;
  meetingId?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export const runAutomations = async (
  clientCode: string,
  ctx: AutomationContext,
): Promise<void> => {
  const repo = await getAutomationRuleRepo(clientCode);

  const ruleFilters: Record<string, any> = {};
  if (ctx.stageId)
    ruleFilters["triggerConfig.stageId"] = new mongoose.Types.ObjectId(
      ctx.stageId,
    );
  if (ctx.tagName) ruleFilters["triggerConfig.tagName"] = ctx.tagName;
  if (ctx.trigger === "score_above" && ctx.score !== undefined)
    ruleFilters["triggerConfig.scoreThreshold"] = { $lte: ctx.score };
  if (ctx.trigger === "score_below" && ctx.score !== undefined)
    ruleFilters["triggerConfig.scoreThreshold"] = { $gte: ctx.score };

  const rules = await repo.findActiveRules(ctx.trigger, ruleFilters);
  if (rules.length === 0) return;

  await Promise.allSettled(
    rules.map(async (rule) => {
      if (rule.isSequence && rule.steps && rule.steps.length > 0) {
        const { enrollInSequence } =
          await import("../automation/sequenceEngine.service.ts");
        await enrollInSequence(
          clientCode,
          (rule as any)._id.toString(),
          ctx.lead,
          ctx.variables,
        );
      } else {
        await executeRule(clientCode, rule, ctx);
      }
    }),
  );
};

export const scheduleMeetingReminders = async (
  clientCode: string,
  meeting: IMeeting,
): Promise<void> => {
  const repo = await getAutomationRuleRepo(clientCode);
  const { Lead } = await getCrmModels(clientCode);
  const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");

  const rules = await repo.findActiveRules("appointment_reminder");

  if (rules.length === 0) return;

  const lead = await Lead.findById(meeting.leadId);
  if (!lead) return;

  const meetCode = meeting.meetLink?.split("/").pop() || "";
  const variables = {
    meet_link: meeting.meetLink || "",
    meet_code: meetCode,
    start_time: meeting.startTime.toISOString(),
    date: meeting.startTime.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: meeting.startTime.toLocaleTimeString("en-IN", {
      hour12: true,
    }),
    participant_name: meeting.participantName,
    meeting_mode: meeting.meetingMode,
    amount: (meeting.amount / 100)?.toString() || "0", // Convert paise/cents to major unit
  };

  for (const rule of rules) {
    console.log(
      `[automationService] Processing reminder rule "${rule.name}" for meeting ${meeting._id}`,
    );

    for (const action of rule.actions) {
      if (action.type !== "send_whatsapp" && action.type !== "send_email")
        continue;

      const offsetMinutes = action.delayMinutes || 0;
      let fireTime: Date;

      // New logic: explicit delayType handling
      switch (action.delayType) {
        case "before_event":
          fireTime = new Date(
            meeting.startTime.getTime() - offsetMinutes * 60 * 1000,
          );
          break;
        case "at_event":
          fireTime = new Date(meeting.startTime);
          break;
        case "after_event":
          fireTime = new Date(
            meeting.startTime.getTime() + offsetMinutes * 60 * 1000,
          );
          break;
        default:
          // Fallback legacy behavior: interpret as "before" for reminder triggers
          fireTime = new Date(
            meeting.startTime.getTime() - offsetMinutes * 60 * 1000,
          );
          break;
      }

      const delayMs = fireTime.getTime() - Date.now();

      // If the reminder is set for a time that has already passed, skip it (with 1m grace)
      if (delayMs <= -60000) {
        console.warn(
          `[automationService] Skipping reminder action ${action.type} as fireTime ${fireTime.toISOString()} is in the past`,
        );
        continue;
      }

      const isValid = await validateActionBeforeEnqueue(
        clientCode,
        action,
        lead,
        (rule as any)._id?.toString() || "",
        variables,
      );

      if (!isValid) {
        console.warn(
          `[automationService] Aborting enqueue for reminder ${meeting._id} due to validation failure`,
        );
        continue;
      }

      await crmQueue.add(
        {
          clientCode,
          type: "crm.automation_action",
          payload: {
            actionType: action.type,
            actionConfig: action.config,
            leadId: lead._id.toString(),
            ruleId: (rule as any)._id.toString(),
            meetingId: meeting._id.toString(), // Pass meetingId for tracking
            actionId: (action as any)._id?.toString(), // Pass actionId
            ctxVariables: variables,
          },
        },
        { delayMs: Math.max(0, delayMs) },
      );

      // Track in meeting model
      if (!(meeting as any).reminders) (meeting as any).reminders = [];
      (meeting as any).reminders.push({
        actionId:
          (action as any)._id?.toString() ||
          new mongoose.Types.ObjectId().toString(),
        type: action.type,
        fireTime,
        status: "pending",
      });

      console.log(
        `[automationService] Scheduled ${action.type} reminder for meeting ${meeting._id} at ${fireTime.toISOString()} (Type: ${action.delayType || "legacy/before"}, Offset: ${offsetMinutes}m)`,
      );
    }

    // Save the meeting with reminder tracking
    const { Meeting } = await getCrmModels(clientCode);
    await Meeting.updateOne(
      { _id: meeting._id },
      { $set: { reminders: (meeting as any).reminders } },
    );
  }
};

// ─── Execute a single rule ────────────────────────────────────────────────────
const executeRule = async (
  clientCode: string,
  rule: IAutomationRule,
  ctx: AutomationContext,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);

  const context = { lead: ctx.lead, ...ctx.variables };
  const legacyPassed = rule.condition
    ? ConditionEvaluator.evaluateSingle(rule.condition, context)
    : true;
  const newPassed = rule.conditions?.length
    ? ConditionEvaluator.evaluate(rule.conditionLogic, rule.conditions, context)
    : true;

  if (!legacyPassed || !newPassed) return;

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
      ctx.meetingId,
    );
  }

  const updateRes = await AutomationRule.updateOne(
    { _id: (rule as any)._id },
    { $inc: { executionCount: 1 }, $set: { lastExecutedAt: new Date() } },
  );
  console.log(`[automationService] Rule execution count updated:`, updateRes);

  const sdk = createSDK(clientCode);
  await sdk.activity.log({
    leadId: ctx.lead._id.toString(),
    type: "automation_triggered",
    title: `Automation: "${rule.name}"`,
    body: `Triggered by: ${rule.trigger}. Actions: ${rule.actions.map((a) => a.type).join(", ")}`,
    metadata: { ruleId: (rule as any)._id.toString(), ruleName: rule.name },
    performedBy: "system",
  });
};

// ─── Execute one action immediately ──────────────────────────────────────────
// Redundant: local executeAction removed in favor of ActionExecutor.execute

// ─── Enqueue delayed action ───────────────────────────────────────────────────

const enqueueDelayedAction = async (
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  ruleId: string,
  variables?: Record<string, string>,
  meetingId?: string,
): Promise<void> => {
  const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");

  // Merge context into actionConfig
  const actionConfig: Record<string, unknown> = {
    ...(action.config as Record<string, unknown>),
    phone: (action.config as any).phone ?? lead.phone,
    email: (action.config as any).email ?? lead.email ?? "",
  };

  const actionPayload =
    typeof (action as any).toObject === "function"
      ? (action as any).toObject()
      : action;

  // We no longer blindly resolvePlaceholders here, we let validateActionBeforeEnqueue do it
  // and return the final structurally resolved config (which includes WhatsApp arrays)
  const validationResult = await validateActionBeforeEnqueue(
    clientCode,
    actionPayload,
    lead,
    ruleId,
    variables,
  );

  if (!validationResult.isValid) {
    console.warn(
      `[automationService] Aborting enqueue for lead ${lead._id} due to validation failure on rule ${ruleId}`,
    );
    return;
  }

  // Calculate delay
  let delayMs = (action.delayMinutes || 0) * 60 * 1000;

  // Handle event-relative delays (e.g. before_event, at_event, after_event)
  if (action.delayType && action.delayType !== "after_trigger") {
    // Look for event time in variables (mapping: appointment_confirmed uses vars.date/vars.time, meeting_created uses vars.start_time)
    const eventTimeStr =
      variables?.start_time ||
      variables?.event_time ||
      (variables?.date && variables?.time
        ? `${variables.date} ${variables.time}`
        : null);

    if (eventTimeStr) {
      const eventTime = new Date(eventTimeStr);
      if (!isNaN(eventTime.getTime())) {
        let fireTime: Date;
        const offsetMs = (action.delayMinutes || 0) * 60 * 1000;

        switch (action.delayType) {
          case "before_event":
            fireTime = new Date(eventTime.getTime() - offsetMs);
            break;
          case "at_event":
            fireTime = new Date(eventTime);
            break;
          case "after_event":
            fireTime = new Date(eventTime.getTime() + offsetMs);
            break;
          default:
            fireTime = new Date(Date.now() + offsetMs);
        }

        delayMs = fireTime.getTime() - Date.now();

        // If fireTime has passed, we can either skip or fire immediately.
        // For reminders, skipping is often safer to avoid spamming "past" events.
        if (delayMs < -60000) {
          console.warn(
            `[automationService] Skipping delayed action ${action.type} for rule ${ruleId} as fireTime ${fireTime.toISOString()} is in the past`,
          );
          return;
        }
      }
    }
  }

  const targetMeetingId =
    meetingId ||
    variables?.meeting_id ||
    (action.config as any)?.meetingId ||
    (action.config as any)?._resolvedContext?.meeting_id;

  const payload = {
    actionType: action.type,
    actionConfig: validationResult.resolvedConfig,
    leadId: lead._id.toString(),
    ruleId,
    ctxVariables: variables, // Keep as fallback/context
    meetingId: targetMeetingId,
  };

  // Track in meeting model if it's a reminder
  if (
    targetMeetingId &&
    (action.type === "send_whatsapp" || action.type === "send_email")
  ) {
    try {
      const { Meeting } = await getCrmModels(clientCode);
      const fireTime = new Date(Date.now() + Math.max(0, delayMs));
      const actionId =
        (action as any)._id?.toString() ||
        new mongoose.Types.ObjectId().toString();

      await Meeting.updateOne(
        { _id: targetMeetingId, clientCode },
        {
          $push: {
            reminders: {
              actionId,
              type: action.type,
              fireTime,
              status: "pending",
            },
          },
        },
      );

      // Add actionId and meetingId to payload for worker status updates
      (payload as any).actionId = actionId;
      (payload as any).meetingId = targetMeetingId;
    } catch (err) {
      console.error(
        `[automationService] Failed to track reminder for meeting ${targetMeetingId}:`,
        err,
      );
    }
  }

  await crmQueue.add(
    {
      clientCode,
      type: "crm.automation_action",
      payload,
    },
    { delayMs: Math.max(0, delayMs) },
  );
};

// ─── Validation before enqueue ────────────────────────────────────────────────

async function validateActionBeforeEnqueue(
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  ruleId: string,
  variables?: Record<string, string>,
): Promise<{ isValid: boolean; resolvedConfig?: any }> {
  const { Notification } = await getCrmModels(clientCode);

  const notifyUser = async (title: string, msg: string, errorType?: string) => {
    const notif = await Notification.create({
      clientCode,
      title,
      message: msg,
      type: "action_required",
      status: "unread",
      actionData: {
        actionType: action.type,
        actionConfig: action,
        leadId: lead._id,
        contextSnapshot: variables || {},
        errorType,
      },
    });
    if ((global as any).io) {
      (global as any).io.to(clientCode).emit("notification:new", notif);
    }
  };

  // 1. WhatsApp & Email Template Mapping Check
  let finalConfig = { ...action.config };
  if (
    action.type === "send_whatsapp" ||
    (action.type === "send_email" && (action.config as any).templateName)
  ) {
    const cfg = action.config as any;
    if (cfg && cfg.templateName) {
      const { resolveUnifiedWhatsAppTemplate, resolveUnifiedEmailTemplate } =
        await import("../whatsapp/template.service.ts");
      const tenantConn = await getTenantConnection(clientCode);
      try {
        if (action.type === "send_whatsapp") {
          const { resolvedVariables, languageCode, isReady, contextSnapshot } =
            await resolveUnifiedWhatsAppTemplate(
              tenantConn,
              cfg.templateName,
              lead,
              variables,
            );

          if (!isReady) {
            await notifyUser(
              "WhatsApp Template Mapping Incomplete",
              `The template "${cfg.templateName}" has missing variable mappings.`,
              "whatsapp_template_incomplete",
            );
            return { isValid: false };
          }

          finalConfig = {
            ...cfg,
            resolvedVariables,
            languageCode,
            _resolvedContext: contextSnapshot,
          };
        } else {
          // Email Template
          const { subject, body, isReady } = await resolveUnifiedEmailTemplate(
            tenantConn,
            cfg.templateName,
            lead,
            variables,
          );

          if (!isReady) {
            await notifyUser(
              "Email Template Mapping Incomplete",
              `The email template "${cfg.templateName}" has missing mappings.`,
              "email_template_incomplete",
            );
            return { isValid: false };
          }

          finalConfig = {
            ...cfg,
            subject,
            htmlBody: body, // Map back to what executeAction expects
          };
        }
      } catch (err: any) {
        await notifyUser(
          `${action.type === "send_whatsapp" ? "WhatsApp" : "Email"} Template Resolution Failed`,
          `Rule tried to resolve template "${cfg.templateName}" but failed: ${err.message}`,
          "template_resolution_failed",
        );
        return { isValid: false };
      }
    }
  }

  // 2. Fallback text placeholder checks for NON-Template actions
  if (
    action.type !== "send_whatsapp" &&
    !(action.type === "send_email" && (action.config as any).templateName)
  ) {
    const resolved = ActionExecutor.resolveTemplate(action.config, {
      lead,
      vars: variables || {},
      event: variables || {},
    });
    finalConfig = resolved;
  }

  return { isValid: true, resolvedConfig: finalConfig };
}

// Placeholder resolver removed in favor of ActionExecutor.resolveTemplate

// ─── Condition evaluator ──────────────────────────────────────────────────────

// Local evaluator removed in favor of ConditionEvaluator service

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
  const conditionResult =
    (rule.condition
      ? ConditionEvaluator.evaluateSingle(rule.condition, lead)
      : true) &&
    (rule.conditions?.length
      ? ConditionEvaluator.evaluate(rule.conditionLogic, rule.conditions, lead)
      : true);
  return {
    passed: conditionResult,
    conditionResult,
    actionsWouldRun: conditionResult ? rule.actions.map((a) => a.type) : [],
  };
};
