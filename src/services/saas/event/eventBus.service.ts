import { getCrmModels } from "@lib/tenant/crm.models";
import { logger } from "@/lib/logger";
import {
  runAutomations,
  scheduleMeetingReminders,
} from "@/services/saas/crm/automation.service";
import { normalizePhone } from "@/utils/phone";

export class EventBus {
  /**
   * Central entry point for all system and custom events.
   * Decouples the trigger source from the automation logic and scheduling.
   *
   * **WORKING PROCESS:**
   * 1. Idempotency Check: Validates `idempotencyKey` to prevent double-processing of webhooks/API calls.
   * 2. Scheduling: If `runAt` or `delayMinutes` is provided, schedules the event via Redis (Bull) instead of immediate execution.
   * 3. Lead Resolution: Identifies the target lead by phone or email.
   * 4. Auto-enrollment: If `createLeadIfMissing` is true, bootstraps a new lead in the configured pipeline/stage.
   * 5. Trigger Mapping: Normalizes incoming triggers (e.g. `lead.created`) to internal enums (`lead_created`) for rule matching.
   * 6. Execution: Dispatches to `runAutomations` to trigger sequences, WhatsApp templates, and notifications.
   * 7. Observability: Persists an `EventLog` for audit trails and failure tracking.
   *
   * **EDGE CASES:**
   * - No Lead Found: If lead resolution fails and auto-creation is disabled, the event is logged as "failed" and dropped.
   * - Duplicate Keys: Returns the existing log immediately without re-triggering logic.
   * - Worker Delay: Scheduled events are offloaded to background workers to preserve API response times.
   *
   * @param {string} clientCode - The tenant's client code.
   * @param {string} trigger - The event name.
   * @param {EventPayload} payload - Data associated with the event.
   * @param {object} [opts] - Scheduling and lead creation flags.
   */
  static async emit(
    clientCode: string,
    trigger: string,
    payload: EventPayload,
    opts?: {
      idempotencyKey?: string;
      runAt?: Date | string;
      delayMinutes?: number;
      createLeadIfMissing?: boolean;
      leadData?: { firstName?: string; lastName?: string; source?: LeadSource };
    },
  ) {
    const { EventLog, Lead, AutomationRule } = await getCrmModels(clientCode);

    // Helper to categorize sources
    const getNormalizedSource = (
      triggerName: string,
      configSource?: string,
    ) => {
      if (configSource) return configSource;
      if (
        triggerName.startsWith("whatsapp") ||
        triggerName.includes("whatsapp")
      )
        return "whatsapp";
      if (triggerName.startsWith("payment") || triggerName.includes("checkout"))
        return "webhook";
      if (triggerName.startsWith("website") || triggerName.includes("website"))
        return "website";
      if (triggerName.startsWith("lead.")) return "manual";
      return "webhook"; // Default for external integrations
    };

    // 1. Idempotency Check
    if (opts?.idempotencyKey) {
      const existing = await EventLog.findOne({
        clientCode,
        idempotencyKey: opts.idempotencyKey,
      });
      if (existing) {
        logger.info(
          `[EventBus] Duplicate event skipped: ${opts.idempotencyKey}`,
        );
        return existing;
      }
    }

    // 2. Handle Delay & Scheduling
    let scheduleDate: Date | null = null;
    if (opts?.runAt) {
      scheduleDate = new Date(opts.runAt);
    } else if (opts?.delayMinutes && opts.delayMinutes > 0) {
      scheduleDate = new Date(Date.now() + opts.delayMinutes * 60 * 1000);
    }

    if (scheduleDate && scheduleDate > new Date()) {
      const { crmQueue } = await import("@/jobs/saas/crmWorker");
      await crmQueue.add(
        clientCode,
        {
          type: "crm.automation_event",
          payload: {
            trigger,
            phone: payload.phone,
            email: payload.email,
            variables: payload.variables,
            data: payload.data,
            // Remove scheduling flags from recursive call to avoid infinite loops
            _originalDelay: opts?.delayMinutes,
            _originalRunAt: opts?.runAt,
          },
        },
        { runAt: scheduleDate },
      );
      logger.info(
        `[EventBus] Event ${trigger} scheduled for: ${scheduleDate.toISOString()}`,
      );
      return;
    }

    // 3. Normalize and Sanitize
    const phone = payload.phone ? normalizePhone(payload.phone) : undefined;
    const sanitizedPayload = JSON.parse(JSON.stringify(payload.data || {}));

    // 3. Initial Log
    const eventLog = await EventLog.create({
      clientCode,
      trigger,
      phone,
      email: payload.email,
      status: "received",
      payload: sanitizedPayload,
      idempotencyKey: opts?.idempotencyKey,
    });

    try {
      // 4. Resolve Lead (Requirement for runAutomations)
      const { Pipeline, PipelineStage, CustomEventDef } =
        await getCrmModels(clientCode);

      // Resolve event definition early for mapping & defaults
      const eventDef = await CustomEventDef.findOne({
        clientCode,
        name: trigger,
        isActive: true,
      });

      let lead = null;
      if (phone) {
        lead = await Lead.findOne({ clientCode, phone });
      } else if (payload.email) {
        lead = await Lead.findOne({ clientCode, email: payload.email });
      }

      if (!lead && opts?.createLeadIfMissing && (phone || payload.email)) {
        const { createLead } = await import("@/services/saas/crm/lead.service");

        let finalPipelineId: string | undefined;
        let finalStageId: string | undefined;

        if (eventDef?.pipelineId) {
          finalPipelineId = eventDef.pipelineId;
          finalStageId = eventDef.stageId;
        }

        try {
          lead = await createLead(clientCode, {
            firstName:
              opts.leadData?.firstName || payload.phone || "New Contact",
            lastName: opts.leadData?.lastName || "",
            email: payload.email || "",
            phone: phone || "",
            source: (opts.leadData?.source as LeadSource) || "webhook",
            pipelineId: finalPipelineId,
            stageId: finalStageId,
            metadata: { extra: { source_event: trigger } },
          });
          logger.info(
            `[EventBus] Auto-created lead for ${phone || payload.email}`,
          );
        } catch (createErr: any) {
          logger.error(
            `[EventBus] Lead auto-creation failed: ${createErr.message}`,
          );
        }
      }

      if (!lead) {
        // Some events might not have a lead yet (or need auto-creation)
        // For now, if no lead, we log and stop
        await EventLog.findByIdAndUpdate(eventLog._id, {
          status: "failed",
          error: "Lead not found for event context",
        });
        logger.warn(
          `[EventBus] No lead found for event ${trigger} (${phone || payload.email})`,
        );
        return;
      }

      // 6. Resolve actual trigger to use for rule matching
      // Mapping for legacy compatibility + new CustomEventDef mapping
      const legacyMap: Record<string, string> = {
        "lead.created": "lead_created",
        "lead.stage_enter": "stage_enter",
        "lead.stage_exit": "stage_exit",
        "lead.deal_won": "deal_won",
        "lead.deal_lost": "deal_lost",
        "lead.tag_added": "tag_added",
        "lead.tag_removed": "tag_removed",
        "lead.score_refreshed": "score_refresh",
        "meeting.created": "meeting_created",
        "payment.captured": "payment_captured",
        "whatsapp.incoming": "whatsapp_incoming",
        appointment_reminder_1h: "appointment_reminder_1h",
        appointment_reminder_15m: "appointment_reminder_15m",
      };

      const mappedTrigger = (eventDef as any)?.mapsTo || trigger;
      const triggerEnum = legacyMap[mappedTrigger] || mappedTrigger;

      // Rules can match the original incoming trigger OR the mapped internal trigger
      const aliases = trigger !== triggerEnum ? [triggerEnum] : [];

      const rulesMatched = await AutomationRule.countDocuments({
        clientCode,
        trigger: { $in: [trigger, ...aliases] },
        isActive: true,
      });

      await EventLog.findByIdAndUpdate(eventLog._id, {
        rulesMatched,
        status: "processing",
      });

      // 6. Execute Automations
      // Build unified event variables context
      const eventVariables: Record<string, string> = {
        ...(payload.variables || {}),
        phone: phone || "",
        email: payload.email || "",
        trigger,
        ...(payload.data
          ? Object.fromEntries(
              Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
            )
          : {}),
      };

      // Resolve final source: Variables (Explicit) > EventDef (Config) > Trigger (Fallback)
      const rawSource =
        eventVariables.source_event || eventDef?.defaultSource || trigger;
      const normalizedSource = getNormalizedSource(trigger, rawSource);

      await runAutomations(clientCode, {
        trigger,
        aliases,
        lead: lead as any,
        variables: eventVariables,
        data: payload.data,
        source: normalizedSource,
        meetingId:
          payload.data?._id?.toString() || payload.variables?.meeting_id,
        stageId:
          payload.variables?.stageId ||
          payload.variables?.toStageId ||
          (lead as any).stageId?.toString(),
        tagName: payload.variables?.tagName,
      });

      // 7. Special Handlers (Observers)
      if (
        (trigger === "meeting.created" || trigger === "meeting.rescheduled") &&
        payload.data
      ) {
        try {
          await scheduleMeetingReminders(clientCode, payload.data as any);
        } catch (err: any) {
          logger.error(
            `[EventBus] Meeting reminder scheduling failed: ${err.message}`,
          );
        }
      }

      // 8. Finalize
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "completed",
        processedAt: new Date(),
      });
    } catch (err: any) {
      logger.error(
        err,
        `[EventBus] Error processing event ${trigger}: ${err.message}`,
      );
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "failed",
        error: err.message,
      });
    }
  }
}
