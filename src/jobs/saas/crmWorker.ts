/**
 * crmWorker.ts
 * Unified async job processor for all CRM actions.
 *
 * Queue name: "crm"
 * Started in server.ts alongside the whatsapp-workflow worker.
 *
 * Job types handled:
 *   crm.automation_action  — delayed automation step (send_whatsapp, send_email, move_stage, assign_to, add_tag, webhook_notify)
 *   crm.automation_event   — delayed external trigger (fires runAutomations after a delay)
 *   crm.email              — transactional or bulk email send
 *   crm.meeting            — async Google Meet creation → fires onMeetingCreated hook
 *   crm.reminder           — appointment/follow-up WhatsApp reminder
 *   crm.score_refresh      — background lead score recalculation
 *   crm.webhook_notify     — fire an HTTP callback to client's server
 */

import { MongoQueue } from "../../lib/mongoQueue/index.ts";
import { MongoWorker } from "../../lib/mongoQueue/worker.ts";
import type { IJob } from "../../model/queue/job.model.ts";
import type { IBroadcast } from "../../model/saas/whatsapp/broadcast.model.ts";
import type { IConversation } from "../../model/saas/whatsapp/conversation.model.ts";

// ─── Exported queue singleton ─────────────────────────────────────────────────
// Use this everywhere you need to enqueue a CRM job:
//   import { crmQueue } from "../saas/crmWorker.ts";
//   await crmQueue.add({ clientCode, type: "crm.email", payload: { ... } });

export const crmQueue = MongoQueue.getQueue("crm");

// ─── Socket.io ref (for WhatsApp real-time UI updates) ───────────────────────

let globalIo: any = null;
export const registerCrmIo = (io: any): void => {
  globalIo = io;
};

// ─── Job type union ───────────────────────────────────────────────────────────

type CrmJobType =
  | "crm.automation_action"
  | "crm.automation_event"
  | "crm.email"
  | "crm.meeting"
  | "crm.reminder"
  | "crm.score_refresh"
  | "crm.webhook_notify"
  | "crm.whatsapp_broadcast";

interface CrmJobData {
  clientCode: string;
  type: CrmJobType;
  payload: Record<string, any>;
}

// ─── Processor ────────────────────────────────────────────────────────────────

const processCrmJob = async (job: IJob): Promise<void> => {
  const { clientCode, type, payload } = job.data as unknown as CrmJobData;

  if (!clientCode || !type) {
    throw new Error(`[crmWorker] Job ${job._id} missing clientCode or type`);
  }

  switch (type) {
    // ── 1. Delayed automation action ─────────────────────────────────────────
    case "crm.automation_action": {
      const { actionType, actionConfig, leadId, ctxVariables } = payload;
      const { getCrmModels } =
        await import("../../lib/tenant/get.crm.model.ts");
      const { Lead } = await getCrmModels(clientCode);
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error(`[crmWorker] Lead ${leadId} not found`);
      }

      const { executeAction } =
        await import("../../services/saas/crm/automation.service.ts");

      // Construct action object for executeAction
      const action = {
        type: actionType,
        config: actionConfig,
        delayMinutes: 0, // It was already delayed by the queue
      };

      // Pass variables from config (stored in enqueueDelayedAction)
      await executeAction(
        clientCode,
        action as any,
        lead as any,
        {
          variables: ctxVariables,
        } as any,
      );
      break;
    }

    // ── 2. Delayed external event (from POST /api/crm/automations/events with delaySeconds > 0) ──
    case "crm.automation_event": {
      const { trigger, leadId, variables, stageId, tagName, score } = payload;
      const { getCrmModels } =
        await import("../../lib/tenant/get.crm.model.ts");
      const { Lead } = await getCrmModels(clientCode);
      const lead = await Lead.findById(leadId).lean();
      if (!lead) {
        throw new Error(
          `[crmWorker] crm.automation_event: lead ${leadId} not found for client ${clientCode}`,
        );
      }
      const { runAutomations } =
        await import("../../services/saas/crm/automation.service.ts");
      await runAutomations(clientCode, {
        trigger,
        lead: lead as any,
        stageId,
        tagName,
        score,
        variables,
      });
      break;
    }

    // ── 3. Email — transactional or bulk ─────────────────────────────────────
    case "crm.email": {
      const { createEmailService } =
        await import("../../services/saas/mail/email.service.ts");
      const svc = createEmailService();

      if (payload.bulk === true && Array.isArray(payload.recipients)) {
        // Bulk campaign — iterates internally, tracks errors per recipient
        await svc.sendCampaign(clientCode, {
          recipients: payload.recipients as string[],
          subject: payload.subject,
          html: payload.html,
        });
      } else {
        // Single transactional email
        await svc.sendEmail(clientCode, {
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      }

      // Callback if requested
      if (payload.callbackUrl) {
        await fetch(payload.callbackUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "sent", sentAt: new Date() }),
        }).catch((e: Error) =>
          console.error("[crmWorker] Email callback failed:", e.message),
        );
      }
      break;
    }

    // ── 3. Google Meet creation ───────────────────────────────────────────────
    case "crm.meeting": {
      const { createGoogleMeetService } =
        await import("../../services/saas/meet/google.meet.service.ts");
      const { onMeetingCreated } =
        await import("../../services/saas/crm/crmHooks.ts");

      const svc = createGoogleMeetService();
      const result = await svc.createMeeting(clientCode, {
        summary: payload.title,
        description: payload.description,
        attendees: payload.attendees ?? [],
        start: payload.startTime,
        end: payload.endTime,
      });

      if (!result.success) {
        throw new Error(`Google Meet creation failed: ${result.error}`);
      }

      // Fire CRM hook — logs timeline + updates score
      await onMeetingCreated(clientCode, {
        phone: payload.phone,
        meetLink: result.hangoutLink ?? "",
        calendarEventId: result.eventId ?? "",
        title: payload.title,
        startTime: payload.startTime ? new Date(payload.startTime) : undefined,
        appointmentId: payload.appointmentId,
        performedBy: "system",
      });

      // Notify client with the meet link
      if (payload.callbackUrl) {
        await fetch(payload.callbackUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "created",
            meetLink: result.hangoutLink,
            eventId: result.eventId,
            createdAt: new Date(),
          }),
        }).catch((e: Error) =>
          console.error("[crmWorker] Meeting callback failed:", e.message),
        );
      }
      break;
    }

    // ── 4. Reminder — WhatsApp reminder before appointment ───────────────────
    case "crm.reminder": {
      const { createWhatsappService } =
        await import("../../services/saas/whatsapp/whatsapp.service.ts");
      const { getTenantConnection, getTenantModel } =
        await import("../../lib/connectionManager.ts");
      const { schemas } = await import("../../model/saas/tenant.schemas.ts");

      const svc = createWhatsappService(globalIo);
      const tenantConn = await getTenantConnection(clientCode);
      const Conversation = getTenantModel(
        tenantConn,
        "Conversation",
        schemas.conversations,
      );

      let conv = await Conversation.findOne({
        clientCode,
        phone: payload.phone,
      });
      if (!conv) {
        conv = await Conversation.create({
          clientCode,
          phone: payload.phone,
          userName: payload.phone,
          status: "open",
          channel: "whatsapp",
        });
      }

      await svc.sendOutboundMessage(
        clientCode,
        conv._id.toString(),
        undefined,
        undefined,
        undefined,
        "system-reminder",
        payload.templateName,
        payload.language ?? "en_US",
        payload.variables ?? [],
      );

      // Log reminder to CRM timeline
      const { logActivity } =
        await import("../../services/saas/crm/activity.service.ts");
      if (payload.leadId) {
        await logActivity(clientCode, {
          leadId: payload.leadId,
          type: "whatsapp_sent",
          title: `Reminder sent: ${payload.templateName}`,
          performedBy: "system-reminder",
        });
      }
      break;
    }

    // ── 5. Score refresh — background recalculation ──────────────────────────
    case "crm.score_refresh": {
      const { recalculateScore } =
        await import("../../services/saas/crm/lead.service.ts");
      await recalculateScore(clientCode, payload.leadId);
      break;
    }

    // ── 6. Webhook notify — fire HTTP callback to client server ──────────────
    case "crm.webhook_notify": {
      const res = await fetch(payload.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.event),
      });
      if (!res.ok) {
        throw new Error(
          `Webhook notify failed [${res.status}]: ${payload.callbackUrl}`,
        );
      }
      break;
    }

    // ── 7. WhatsApp Broadcast — sending individual messages in a campaign ──
    case "crm.whatsapp_broadcast": {
      const { broadcastId, phone, templateName, templateLanguage, variables } =
        payload;

      const { createWhatsappService } = await import(
        "../../services/saas/whatsapp/whatsapp.service.ts"
      );
      const { getTenantConnection, getTenantModel } = await import(
        "../../lib/connectionManager.ts"
      );
      const { schemas } = await import("../../model/saas/tenant.schemas.ts");

      const svc = createWhatsappService(globalIo);
      const tenantConn = await getTenantConnection(clientCode);
      const Broadcast = getTenantModel<IBroadcast>(
        tenantConn,
        "Broadcast",
        schemas.broadcasts,
      );
      const Conversation = getTenantModel<IConversation>(
        tenantConn,
        "Conversation",
        schemas.conversations,
      );

      let success = false;
      try {
        let conv = await Conversation.findOne({ phone });
        if (!conv) {
          conv = await Conversation.create({
            phone,
            userName: "Customer",
            status: "open",
            channel: "whatsapp",
            unreadCount: 0,
          });
        }

        await svc.sendOutboundMessage(
          clientCode,
          conv._id.toString(),
          undefined,
          undefined,
          undefined,
          "broadcast",
          templateName,
          templateLanguage || "en_US",
          variables || [],
        );
        success = true;
      } catch (err: any) {
        console.error(
          `[crmWorker] Broadcast send failed for ${phone}:`,
          err.message,
        );
      }

      // Update broadcast stats
      const update: any = {
        $inc: {},
      };
      if (success) update.$inc.sentCount = 1;
      else update.$inc.failedCount = 1;

      const updatedBroadcast = await Broadcast.findByIdAndUpdate(
        broadcastId,
        update,
        { new: true, returnDocument: "after" },
      );

      if (updatedBroadcast) {
        const totalProcessed =
          updatedBroadcast.sentCount + updatedBroadcast.failedCount;
        if (totalProcessed >= updatedBroadcast.totalRecipients) {
          updatedBroadcast.status =
            updatedBroadcast.failedCount > 0 ? "partially_failed" : "completed";
          updatedBroadcast.completedAt = new Date();
          await updatedBroadcast.save();
        }

        // Optional: Emit broadcast progress via socket
        if (globalIo) {
          globalIo.to(clientCode).emit("broadcast_progress", {
            broadcastId,
            sentCount: updatedBroadcast.sentCount,
            failedCount: updatedBroadcast.failedCount,
            status: updatedBroadcast.status,
          });
        }
      }

      break;
    }

    default: {
      throw new Error(`[crmWorker] Unknown job type: ${type}`);
    }
  }
};

// ─── Worker factory ───────────────────────────────────────────────────────────

export const startCrmWorker = (): MongoWorker => {
  const worker = new MongoWorker("crm", processCrmJob, {
    concurrency: 3, // process 3 jobs in parallel
    pollIntervalMs: 5_000, // poll every 5 seconds
    baseBackoffMs: 10_000, // retry with 10s base exponential backoff
  });
  worker.start();
  console.log("[crmWorker] ✅ Started — queue: crm, concurrency: 3, poll: 5s");
  return worker;
};
