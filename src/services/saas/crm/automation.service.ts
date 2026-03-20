/**
 * @file src/services/saas/crm/automation.service.ts
 * @module AutomationService
 * @responsibility Orchestrates the discovery and execution of automation rules and sequences.
 * @dependencies @lib/tenant/crm.models, @/sdk/index, ActionExecutor, ConditionEvaluator
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import mongoose from "mongoose";
import { createSDK } from "@/sdk/index";
import { ActionExecutor } from "../automation/actionExecutor.service";
import { ConditionEvaluator } from "../automation/conditionEvaluator.service";
import { getAutomationRuleRepo } from "./automation.repository";

// ─── Main entry point ─────────────────────────────────────────────────────────
/**
 * Core entry point for triggering automations.
 *
 * **WORKING PROCESS:**
 * 1. Initializes a repository scoped to the tenant's database connection.
 * 2. Builds a filter set based on the current context (stage, tags, score).
 * 3. Handles source-based isolation (Manual vs Webhook vs Website).
 * 4. Checks for available automation credits via `UsageService`.
 * 5. Executes actions instantly or enrolls the lead into a sequence.
 *
 * @param {string} clientCode - The unique tenant identifier.
 * @param {AutomationContext} ctx - Unified context containing event triggers and data.
 * @returns {Promise<void>} Resolves when all relevant rules have been processed or scheduled.
 * @throws {Error} If database connection or credit deduction fails.
 * @edge_case Generic rules are isolated to manual/CRM activities by default to prevent unintended triggers.
 */
/**
 * Core entry point for triggering automations based on real-time events.
 *
 * **WORKING PROCESS:**
 * 1. Model Scope: Initializes the `AutomationRule` repository scoped to the tenant's connection.
 * 2. Active Discovery: Searches for enabled rules matching the specific `trigger` (e.g., stage_change, incoming_message).
 * 3. Industrial Filtering: Applies source-level isolation. Generic rules are restricted to "manual" or "crm" sources to prevent interference with specialized webhooks.
 * 4. Resource Check: Consumes 1 automation credit via `UsageService`. If exhausted, the run is aborted to prevent overages.
 * 5. Execution Branching: Instantly executes simple rules or enqueues sequences into the `SequenceEngine`.
 *
 * **EDGE CASES:**
 * - Credit Exhaustion: Silently skips execution if the tenant has no automation units remaining.
 * - Source Hijacking: Prevents generic automation from firing on technical webhooks (e.g., website leads) unless explicitly included.
 *
 * @param clientCode - The unique tenant identifier.
 * @param ctx - Context containing the trigger event, lead data, and dynamic variables.
 */
export const runAutomations = async (
  clientCode: string,
  ctx: AutomationContext,
): Promise<void> => {
  const repo = await getAutomationRuleRepo(clientCode);

  const ruleFilters: Record<string, any> = {};
  // Filters for stage/tag specific rules
  ruleFilters["triggerConfig.stageId"] = ctx.stageId
    ? { $in: [new mongoose.Types.ObjectId(ctx.stageId), null] }
    : null;

  ruleFilters["triggerConfig.tagName"] = ctx.tagName
    ? { $in: [ctx.tagName, null] }
    : null;
  if (ctx.trigger === "score_above" && ctx.score !== undefined)
    ruleFilters["triggerConfig.scoreThreshold"] = { $lte: ctx.score };
  if (ctx.trigger === "score_below" && ctx.score !== undefined)
    ruleFilters["triggerConfig.scoreThreshold"] = { $gte: ctx.score };

  const queryTriggers = [ctx.trigger, ...(ctx.aliases || [])];
  const rules = await repo.findActiveRules(queryTriggers, ruleFilters);
  if (rules.length === 0) return;

  // Industrial Filtering: Source Exclusion/Inclusion
  const filteredRules = rules.filter((rule) => {
    const { includeSources, excludeSources } = rule.triggerConfig || {};
    const source = ctx.source || ctx.variables?.source_event;

    if (includeSources?.length && source && !includeSources.includes(source)) {
      return false;
    }
    // Dynamic Source Isolation Policy:
    // 1. If explicit filters exist (include/exclude), strictly follow them.
    if (includeSources?.length) {
      if (!source || !includeSources.includes(source)) return false;
    }
    if (excludeSources?.length) {
      if (source && excludeSources.includes(source)) return false;
    }

    // 2. If NO filters exist (Generic Rule), apply Default Isolation.
    // Generic rules ONLY run for Manual/CRM activities to prevent hijacking of specialized sources.
    const isGenericRule = !includeSources?.length && !excludeSources?.length;
    if (isGenericRule) {
      const isManualActivity = !source || ["manual", "crm"].includes(source);
      if (!isManualActivity) return false;
    }

    return true;
  });

  if (filteredRules.length === 0) return;

  // Credit Tracking: Deduct for an Automation "Burst" Run
  const { UsageService } = await import("@services/global/usage.service");
  const hasCredits = await UsageService.consume(
    clientCode,
    "automation_run",
    1,
  );
  if (!hasCredits) {
    console.warn(
      `[automationService] Skipping run for ${clientCode} due to credit exhaustion.`,
    );
    return;
  }

  await Promise.allSettled(
    filteredRules.map(async (rule) => {
      if (rule.isSequence && rule.steps && rule.steps.length > 0) {
        const { enrollInSequence } = await import(
          "../automation/sequenceEngine.service.ts"
        );
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

/**
 * Orchestrates appointment reminders based on meeting schedules.
 *
 * **WORKING PROCESS:**
 * 1. Fetches all active rules with the `appointment_reminder` trigger.
 * 2. Prepares a variables context from the meeting data (date, time, meet links, etc.).
 * 3. For each rule action:
 *    - Calculates the exact `fireTime` based on `delayType` (before, at, or after the event).
 *    - Validates the action and enqueues it into `crmQueue` with the calculated delay.
 *    - Persists the scheduled reminder state in the `Meeting` document for tracking.
 *
 * @param {string} clientCode - Tenant's unique code.
 * @param {IMeeting} meeting - The source meeting document.
 * @returns {Promise<void>}
 * @edge_case Skips reminders that are calculated to be in the past (more than 1 minute).
 */
/**
 * Orchestrates appointment reminders for upcoming meetings.
 *
 * **WORKING PROCESS:**
 * 1. Rule Lookup: Fetches all rules associated with the `appointment_reminder` trigger.
 * 2. Context Mapping: Creates a rich variable set (meet_link, date, time, mode) from the meeting document.
 * 3. Adaptive Timing: Calculates the `fireTime` based on the action's `delayType` (before, at, or after the meeting start).
 * 4. Resilience: Validates each action/template and enqueues high-priority jobs into `crmQueue`.
 * 5. State Persistence: Records the scheduled reminders in the `Meeting` document for UI visibility and tracking.
 *
 * **EDGE CASES:**
 * - Past Scheduling: If a reminder is calculated to fire in the past (e.g., 30m before a meeting that starts in 10m), it is skipped.
 * - Missing Meet Link: Variables are safely defaulted to prevent template resolution errors.
 *
 * @param clientCode - Tenant's unique code.
 * @param meeting - The source meeting metadata.
 */
export const scheduleMeetingReminders = async (
  clientCode: string,
  meeting: IMeeting,
): Promise<void> => {
  const repo = await getAutomationRuleRepo(clientCode);
  const { Lead } = await getCrmModels(clientCode);
  const { crmQueue } = await import("@/jobs/saas/crmWorker");

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
        clientCode,
        {
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
    ).lean();
  }
};

// ─── Execute a single rule ────────────────────────────────────────────────────
/**
 * Evaluates and executes a single automation rule.
 *
 * **WORKING PROCESS:**
 * 1. Merges lead data and event variables into a unified context.
 * 2. Evaluates both legacy and new multi-condition logic.
 * 3. If conditions pass, enqueues all rule actions as background jobs.
 * 4. Increments the global execution counter for the rule and logs the activity.
 *
 * @private
 * @param {string} clientCode - Tenant's unique code.
 * @param {IAutomationRule} rule - The rule configuration.
 * @param {AutomationContext} ctx - Event context.
 */
/**
 * Evaluates and processes a single automation rule against a specific lead.
 *
 * **WORKING PROCESS:**
 * 1. Context Merging: Combines lead attributes with event-specific variables.
 * 2. Logical Evaluation: Runs both legacy (single) and modern (multi-condition) logic tests via `ConditionEvaluator`.
 * 3. Action Dispatch: If conditions pass, enqueues all configured actions as individual jobs.
 * 4. Analytics Update: Increments the execution counter and updates the `lastExecutedAt` timestamp on the rule.
 * 5. Activity Log: Records the automation trigger in the Lead's activity timeline.
 *
 * **EDGE CASES:**
 * - Partial Failure: If one action fails to enqueue, others will still proceed due to loop isolation (though typically atomic).
 *
 * @private
 */
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

/**
 * Safely enqueues an action into the job queue with appropriate delays.
 *
 * **WORKING PROCESS:**
 * 1. Merges lead contact info (phone/email) into the action config.
 * 2. Runs pre-enqueue validation (resolves templates, checks for completeness).
 * 3. Calculates `delayMs` based on absolute time (events) or relative time (after trigger).
 * 4. Enqueues the full payload into `crmQueue`.
 * 5. If linked to a meeting, updates the meeting's reminder tracking list.
 *
 * @param {string} clientCode - Tenant's unique code.
 * @param {IAutomationAction} action - Action to be queued.
 * @param {ILead} lead - Target lead.
 * @param {string} ruleId - Source rule ID.
 * @param {Record<string, string>} [variables] - Dynamic context.
 * @param {string} [meetingId] - Optional linked meeting.
 */
/**
 * Safely enqueues a delayed automation action into the persistent job system.
 *
 * **WORKING PROCESS:**
 * 1. Configuration Mapping: Merges physical contact details (phone/email) from the lead into the action data.
 * 2. Proactive Validation: Resolves templates and checks for mapping errors *before* the job hits the queue.
 * 3. Relative Delay Logic: Translates minutes or event-relative times into absolute `delayMs` for the BullMQ scheduler.
 * 4. Tracking Linkage: If the action is a meeting reminder, it's cross-referenced in the `Meeting` database for status tracking.
 *
 * **EDGE CASES:**
 * - Stale Data: Validates `fireTime` to ensure actions aren't queued for the past.
 * - Template Errors: Aborts enqueue if the template mapping is broken, preventing worker retries on "doomed" jobs.
 */
const enqueueDelayedAction = async (
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  ruleId: string,
  variables?: Record<string, string>,
  meetingId?: string,
): Promise<void> => {
  const { crmQueue } = await import("@/jobs/saas/crmWorker");

  // Merge context into actionConfig
  const _actionConfig: Record<string, unknown> = {
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
      if (!Number.isNaN(eventTime.getTime())) {
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
      ).lean();

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
    clientCode,
    {
      type: "crm.automation_action",
      payload,
    },
    { delayMs: Math.max(0, delayMs) },
  );
};

// ─── Validation before enqueue ────────────────────────────────────────────────

/**
 * Validates and pre-resolves action configurations before they hit the queue.
 *
 * **WORKING PROCESS:**
 * 1. Checks if the action requires a template (WhatsApp/Email).
 * 2. Resolves the template using `resolveUnifiedWhatsAppTemplate` or `resolveUnifiedEmailTemplate`.
 * 3. Verifies "Readiness" (e.g., all variables mapped).
 * 4. If validation fails, creates an in-app `Notification` for the user to resolve.
 * 5. Returns a sanitised and pre-populated configuration to prevent worker-side failures.
 *
 * @async
 * @param {string} clientCode - Tenant's unique code.
 * @param {IAutomationAction} action - The raw action object.
 * @param {ILead} lead - Target lead.
 * @param {string} _ruleId - Source rule identifier.
 * @param {Record<string, string>} [variables] - Event variables.
 * @returns {Promise<{ isValid: boolean; resolvedConfig?: any }>} Validation status and fixed config.
 * @edge_case Creates a `Notification` on failure to alert the tenant about broken automations.
 */
async function validateActionBeforeEnqueue(
  clientCode: string,
  action: IAutomationAction,
  lead: ILead,
  _ruleId: string,
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
    if (cfg?.templateName) {
      const { resolveUnifiedWhatsAppTemplate, resolveUnifiedEmailTemplate } =
        await import("../whatsapp/template.service.ts");
      const { conn: tenantConn } = await getCrmModels(clientCode);

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
  return AutomationRule.find({ clientCode }).sort({ createdAt: -1 }).lean();
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
  const doc = await AutomationRule.create({ clientCode, ...input });
  return doc.toObject();
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
  ).lean();
};

export const deleteRule = async (
  clientCode: string,
  ruleId: string,
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  await AutomationRule.deleteOne({ _id: ruleId, clientCode });
};

export const deleteRules = async (
  clientCode: string,
  ruleIds: string[],
): Promise<void> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  await AutomationRule.deleteMany({ _id: { $in: ruleIds }, clientCode });
};

export const toggleRule = async (
  clientCode: string,
  ruleId: string,
): Promise<IAutomationRule | null> => {
  const { AutomationRule } = await getCrmModels(clientCode);
  const rule = await AutomationRule.findOne({ _id: ruleId, clientCode }).lean();
  if (!rule) return null;
  return AutomationRule.findByIdAndUpdate(
    ruleId,
    { $set: { isActive: !rule.isActive } },
    { returnDocument: "after" },
  ).lean();
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
    AutomationRule.findOne({ _id: ruleId, clientCode }).lean(),
    Lead.findOne({ _id: leadId, clientCode }).lean(),
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
    actionsWouldRun: conditionResult
      ? rule.actions.map((a: any) => a.type)
      : [],
  };
};
