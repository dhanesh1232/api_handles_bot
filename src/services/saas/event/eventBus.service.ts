import { getCrmModels } from "@lib/tenant/crm.models";
import { logger } from "@/lib/logger";
import {
  runAutomations,
  scheduleMeetingReminders,
} from "@/services/saas/crm/automation.service";
import { normalizePhone } from "@/utils/phone";

export interface EventPayload {
  phone?: string;
  email?: string;
  variables?: Record<string, string>;
  data?: Record<string, any>;
}

export class EventBus {
  /**
   * Central entry point for all system and custom events.
   * Decouples the trigger source from the automation logic.
   *
   * @param clientCode The tenant's client code
   * @param trigger The event name (e.g. "lead.created", "payment.captured")
   * @param payload Data associated with the event
   * @param opts Extra options like idempotencyKey
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
      await crmQueue.add({
        clientCode,
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
        runAt: scheduleDate,
      });
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

      await runAutomations(clientCode, {
        trigger,
        aliases,
        lead: lead as any,
        variables: eventVariables,
        data: payload.data,
        meetingId:
          payload.data?._id?.toString() || payload.variables?.meeting_id,
        stageId:
          payload.variables?.stageId ||
          payload.variables?.toStageId ||
          (lead as any).stageId?.toString(),
        tagName: payload.variables?.tagName,
      });

      // 7. Special Handlers (Observers)
      if (trigger === "meeting.created" && payload.data) {
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
