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
import { ConversationSchema } from "../../../model/saas/tenant.schemas.ts";

import { normalizePhone } from "../../../utils/phone.ts";
import { logActivity } from "./activity.service.ts";

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
  const { AutomationRule, Lead } = await getCrmModels(clientCode);
  const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");

  const rules = await AutomationRule.find({
    clientCode,
    trigger: "appointment_reminder",
    isActive: true,
  });

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
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    patient_name: meeting.patientName,
    doctor_name: meeting.doctorId || "Doctor",
    consultation_type: meeting.consultationType,
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
      if ((meeting as any).reminders) {
        (meeting as any).reminders.push({
          actionId:
            (action as any)._id?.toString() ||
            new mongoose.Types.ObjectId().toString(),
          type: action.type,
          fireTime,
          status: "pending",
        });
      }

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

/**
 *
 * @param clientCode
 * @param action
 * @param lead
 * @param ctx
 * @returns
 */
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

      const rawPhone = cfg.phone || lead.phone;
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        console.error(
          "❌ [automationService] Cannot send WhatsApp: Lead has no valid phone",
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

      // In the new architecture, variables are resolved *AT ENQUEUE TIME*
      // so the cfg object should already contain the perfect array of strings
      const cfgAny = cfg as any;
      const finalVariables: string[] =
        cfgAny.resolvedVariables ?? cfgAny.variables ?? [];

      if (!finalVariables) {
        console.warn(
          `[executeAction] No variables array found on queued config for ${cfg.templateName}`,
        );
        return; // Abort sending
      }

      try {
        await service.sendOutboundMessage(
          clientCode,
          conv._id.toString(),
          undefined,
          undefined,
          undefined,
          "automation",
          cfg.templateName,
          cfgAny.languageCode || "en_US",
          finalVariables,
        );
      } catch (err: any) {
        console.error(
          `[automationService] WhatsApp send failed for template ${cfg.templateName}:`,
          err.message,
        );
        const { Notification } = await getCrmModels(clientCode);
        const notif = await Notification.create({
          clientCode,
          title: "Automation Failure: WhatsApp",
          message: `Template "${cfg.templateName}" failed to send to ${phone}. Error: ${err.message}`,
          type: "action_required",
          status: "unread",
          actionData: {
            actionConfig: action,
            leadId: lead._id,
            error: err.message,
          },
        });
        if ((global as any).io)
          (global as any).io.to(clientCode).emit("notification:new", notif);
        throw err;
      }
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
    case "move_stage":
    case "move_pipeline": {
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
      // Config:
      //   summary?          string   — meeting title (supports {{lead.*}} placeholders)
      //   startTimeVar?     string   — var key holding ISO date string (defaults to now)
      //   durationMinutes?  number   — defaults to 30
      //   attendeeEmailVar? string   — var key holding attendee email
      //   attendeeEmail?    string   — explicit email (fallback: lead.email)
      //   callbackUrl?      string   — receives { meetLink, eventId } on success
      const { createGoogleMeetService } =
        await import("../meet/google.meet.service.ts");
      const gmService = createGoogleMeetService();

      const cfg = config as {
        summary?: string;
        startTimeVar?: string;
        durationMinutes?: number;
        attendeeEmailVar?: string;
        attendeeEmail?: string;
        callbackUrl?: string;
      };

      const startIso =
        cfg.startTimeVar && ctx?.variables?.[cfg.startTimeVar]
          ? ctx.variables[cfg.startTimeVar]
          : new Date().toISOString();

      const durationMs = (cfg.durationMinutes ?? 30) * 60_000;
      const endIso = new Date(
        new Date(startIso).getTime() + durationMs,
      ).toISOString();

      const attendeeEmail =
        (cfg.attendeeEmailVar && ctx?.variables?.[cfg.attendeeEmailVar]) ||
        cfg.attendeeEmail ||
        lead.email ||
        "";

      const meetResult = await gmService.createMeeting(clientCode, {
        summary: cfg.summary || `Meeting with ${lead.firstName}`,
        start: startIso,
        end: endIso,
        attendees: attendeeEmail ? [attendeeEmail] : [],
        description: `Lead: ${lead._id} | Trigger: ${ctx?.trigger ?? "automation"}`,
      });

      if (meetResult.success) {
        console.log(
          `[automationService] Meet created: ${meetResult.hangoutLink}`,
        );
        if (cfg.callbackUrl) {
          const { sendCallbackWithRetry } =
            await import("../../../lib/callbackSender.ts");
          void sendCallbackWithRetry({
            clientCode,
            callbackUrl: cfg.callbackUrl,
            payload: {
              status: "created",
              meetLink: meetResult.hangoutLink,
              eventId: meetResult.eventId,
              leadId: lead._id.toString(),
              phone: lead.phone,
            },
          });
        }
      } else {
        console.warn(
          `[automationService] Meet creation failed:`,
          (meetResult as any).error,
        );
      }
      break;
    }

    case "send_callback": {
      // Config:
      //   url      string   — target URL
      //   method?  "POST" | "PUT" — defaults to POST
      //   payload? Record<string, string> — values support {{vars.*}} and {{lead.*}} placeholders
      const { sendCallbackWithRetry } =
        await import("../../../lib/callbackSender.ts");

      const cfg = config as {
        url: string;
        method?: "POST" | "PUT";
        payload?: Record<string, string>;
      };

      if (!cfg.url) {
        console.warn("[automationService] send_callback: no url configured");
        break;
      }

      const resolvedPayload: Record<string, string> = {};
      if (cfg.payload) {
        for (const [k, v] of Object.entries(cfg.payload)) {
          resolvedPayload[k] = resolvePlaceholders(
            v,
            lead,
            ctx?.variables,
          ) as string;
        }
      }

      void sendCallbackWithRetry({
        clientCode,
        callbackUrl: cfg.url,
        method: cfg.method ?? "POST",
        payload: {
          ...resolvedPayload,
          leadId: lead._id.toString(),
          phone: lead.phone,
          trigger: ctx?.trigger ?? "",
          timestamp: new Date().toISOString(),
        },
      });
      break;
    }

    case "update_lead": {
      // Config:
      //   fields  Record<string, string> — lead field names, values support {{vars.*}}
      const { Lead } = await getCrmModels(clientCode);
      const cfg = config as { fields: Record<string, string> };

      if (!cfg.fields || !Object.keys(cfg.fields).length) {
        console.warn("[automationService] update_lead: no fields configured");
        break;
      }

      const updatedFields: Record<string, string> = {};
      for (const [field, value] of Object.entries(cfg.fields)) {
        updatedFields[field] = resolvePlaceholders(
          value,
          lead,
          ctx?.variables,
        ) as string;
      }

      await Lead.updateOne(
        { _id: lead._id, clientCode },
        { $set: updatedFields },
      );
      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "system",
        title: "Lead fields updated by automation",
        body: `Fields updated: ${Object.keys(updatedFields).join(", ")}`,
        metadata: { updatedFields },
        performedBy: "automation",
      });
      break;
    }

    case "create_note": {
      // Config:
      //   body  string — note content, supports {{vars.*}} and {{lead.*}} placeholders
      const { LeadNote } = await getCrmModels(clientCode);
      const cfg = config as { body: string };

      if (!cfg.body) {
        console.warn("[automationService] create_note: no body configured");
        break;
      }

      const noteBody = resolvePlaceholders(
        cfg.body,
        lead,
        ctx?.variables,
      ) as string;

      await LeadNote.create({
        clientCode,
        leadId: lead._id,
        content: noteBody,
        createdBy: "automation",
        isPinned: false,
      });

      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "note_added",
        title: "Note added by automation",
        body: noteBody,
        performedBy: "automation",
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

  await crmQueue.add(
    {
      clientCode,
      type: "crm.automation_action",
      payload: {
        actionType: action.type,
        actionConfig: validationResult.resolvedConfig,
        leadId: lead._id.toString(),
        ruleId,
        ctxVariables: variables, // Keep as fallback/context
      },
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

  const notifyUser = async (title: string, msg: string) => {
    const notif = await Notification.create({
      clientCode,
      title,
      message: msg,
      type: "action_required",
      status: "unread",
      actionData: {
        actionConfig: action,
        leadId: lead._id,
        contextSnapshot: variables || {},
      },
    });
    if ((global as any).io) {
      (global as any).io.to(clientCode).emit("notification:new", notif);
    }
  };

  // 1. WhatsApp native mapping check AND early resolution
  let finalConfig = { ...action.config };
  if (action.type === "send_whatsapp") {
    const cfg = action.config as any;
    if (cfg && cfg.templateName) {
      const { resolveUnifiedWhatsAppTemplate } =
        await import("../whatsapp/template.service.ts");
      const tenantConn = await getTenantConnection(clientCode);
      try {
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
            `The template "${cfg.templateName}" has missing variable mappings in the database.`,
          );
          return { isValid: false };
        }

        // Successfully resolved. Overwrite the config we will store in the job
        finalConfig = {
          ...cfg,
          resolvedVariables,
          languageCode,
          _resolvedContext: contextSnapshot,
        };
      } catch (err: any) {
        await notifyUser(
          "WhatsApp Template Resolution Failed",
          `Rule tried to resolve template "${cfg.templateName}" but failed: ${err.message}`,
        );
        return { isValid: false };
      }
    }
  }

  // 2. Fallback text placeholder checks for NON-WhatsApp actions
  if (action.type !== "send_whatsapp") {
    const resolved = resolvePlaceholders(action.config, lead, variables);
    finalConfig = resolved; // Store the resolved text config
    const str = JSON.stringify(resolved);
    const unmappedMatches = str.match(/\{\{(vars|lead|event)[^}]*\}\}/);
    if (unmappedMatches) {
      await notifyUser(
        "Unresolved Variables in Action",
        `The action (${action.type}) contains unresolved variables (${unmappedMatches[0]}) which will result in broken messages.`,
      );
      return { isValid: false };
    }
  }

  return { isValid: true, resolvedConfig: finalConfig };
}

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
    /\{\{(vars|lead|event|resolved)\.([^}]+)\}\}/g,
    (match, type, key) => {
      if (type === "vars" || type === "event") {
        return variables?.[key] ?? match;
      }
      if (type === "lead") {
        // Handle nested lead fields (metadata.city)
        return (
          key.split(".").reduce((o: any, i: string) => (o as any)?.[i], lead) ??
          match
        ).toString();
      }
      if (type === "resolved") {
        // Support some basic resolved vars
        if (key === "today") return new Date().toLocaleDateString();
        if (key === "now") return new Date().toLocaleTimeString();
        return variables?.[key] ?? match;
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
