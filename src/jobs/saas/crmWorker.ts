/**
 * crmWorker.ts
 * Unified async job processor for all CRM actions.
 *
 * Queue name: "crm"
 * Started in server.ts alongside the whatsapp-workflow worker.
 *
 * Job types handled:
 *   crm.automation_action  — delayed automation step (send_whatsapp, send_email, move_stage, assign_to, add_tag, webhook_notify)
 *   crm.email              — transactional or bulk email send
 *   crm.meeting            — async Google Meet creation → fires onMeetingCreated hook
 *   crm.reminder           — appointment/follow-up WhatsApp reminder
 *   crm.score_refresh      — background lead score recalculation
 *   crm.webhook_notify     — fire an HTTP callback to client's server
 */

import { MongoQueue } from "../../lib/mongoQueue/index.ts";
import { MongoWorker } from "../../lib/mongoQueue/worker.ts";
import type { IJob } from "../../model/queue/job.model.ts";

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
  | "crm.email"
  | "crm.meeting"
  | "crm.reminder"
  | "crm.score_refresh"
  | "crm.webhook_notify";

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
      const { actionType, actionConfig, leadId } = payload;

      switch (actionType) {

        case "send_whatsapp": {
          const { createWhatsappService } = await import(
            "../../services/saas/whatsapp/whatsappService.ts"
          );
          const svc = createWhatsappService(globalIo);
          // Find or create a conversation for this phone, then send
          const {
            getTenantConnection,
            getTenantModel,
          } = await import("../../lib/connectionManager.ts");
          const { schemas } = await import("../../model/saas/tenantSchemas.ts");
          const tenantConn = await getTenantConnection(clientCode);
          const Conversation = getTenantModel(tenantConn, "Conversation", schemas.conversations);
          let conv = await Conversation.findOne({ clientCode, phone: actionConfig.phone });
          if (!conv) {
            conv = await Conversation.create({
              clientCode,
              phone:    actionConfig.phone,
              userName: actionConfig.phone,
              status:   "open",
              channel:  "whatsapp",
            });
          }
          await svc.sendOutboundMessage(
            clientCode,
            conv._id.toString(),
            undefined, undefined, undefined,
            "automation",
            actionConfig.templateName,
            actionConfig.language ?? "en_US",
            actionConfig.variables ?? [],
          );
          break;
        }

        case "send_email": {
          const { createEmailService } = await import(
            "../../services/saas/mail/emailService.ts"
          );
          const svc = createEmailService();
          await svc.sendEmail(clientCode, {
            to:      actionConfig.email,
            subject: actionConfig.subject,
            html:    actionConfig.htmlBody,
            text:    actionConfig.textBody,
          });
          break;
        }

        case "move_stage": {
          const { moveLead } = await import(
            "../../services/saas/crm/lead.service.ts"
          );
          await moveLead(clientCode, leadId, actionConfig.stageId, "automation");
          break;
        }

        case "assign_to": {
          const Lead = (await import("../../model/saas/crm/lead.model.ts")).default;
          const { logActivity } = await import("../../services/saas/crm/activity.service.ts");
          await Lead.updateOne(
            { _id: leadId, clientCode },
            { $set: { assignedTo: actionConfig.assignTo } },
          );
          await logActivity(clientCode, {
            leadId,
            type:        "lead_assigned",
            title:       `Assigned to ${actionConfig.assignTo}`,
            performedBy: "automation",
          });
          break;
        }

        case "add_tag":
        case "remove_tag": {
          const { updateTags } = await import("../../services/saas/crm/lead.service.ts");
          const toAdd    = actionType === "add_tag"    ? [actionConfig.tag] : [];
          const toRemove = actionType === "remove_tag" ? [actionConfig.tag] : [];
          await updateTags(clientCode, leadId, toAdd, toRemove);
          break;
        }

        case "webhook_notify": {
          await fetch(actionConfig.callbackUrl, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event:     actionConfig.event ?? "crm.automation_triggered",
              leadId,
              timestamp: new Date().toISOString(),
            }),
          });
          break;
        }

        default:
          throw new Error(`[crmWorker] Unknown automation actionType: ${actionType}`);
      }
      break;
    }

    // ── 2. Email — transactional or bulk ─────────────────────────────────────
    case "crm.email": {
      const { createEmailService } = await import(
        "../../services/saas/mail/emailService.ts"
      );
      const svc = createEmailService();

      if (payload.bulk === true && Array.isArray(payload.recipients)) {
        // Bulk campaign — iterates internally, tracks errors per recipient
        await svc.sendCampaign(clientCode, {
          recipients: payload.recipients as string[],
          subject:    payload.subject,
          html:       payload.html,
        });
      } else {
        // Single transactional email
        await svc.sendEmail(clientCode, {
          to:      payload.to,
          subject: payload.subject,
          html:    payload.html,
          text:    payload.text,
        });
      }

      // Callback if requested
      if (payload.callbackUrl) {
        await fetch(payload.callbackUrl, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ status: "sent", sentAt: new Date() }),
        }).catch((e: Error) => console.error("[crmWorker] Email callback failed:", e.message));
      }
      break;
    }

    // ── 3. Google Meet creation ───────────────────────────────────────────────
    case "crm.meeting": {
      const { createGoogleMeetService } = await import(
        "../../services/saas/googleMeetService.ts"
      );
      const { onMeetingCreated } = await import(
        "../../services/saas/crm/crmHooks.ts"
      );

      const svc    = createGoogleMeetService();
      const result = await svc.createMeeting(clientCode, {
        summary:     payload.title,
        description: payload.description,
        attendees:   payload.attendees ?? [],
        start:       payload.startTime,
        end:         payload.endTime,
      });

      if (!result.success) {
        throw new Error(`Google Meet creation failed: ${result.error}`);
      }

      // Fire CRM hook — logs timeline + updates score
      await onMeetingCreated(clientCode, {
        phone:           payload.phone,
        meetLink:        result.hangoutLink ?? "",
        calendarEventId: result.eventId ?? "",
        title:           payload.title,
        startTime:       payload.startTime ? new Date(payload.startTime) : undefined,
        appointmentId:   payload.appointmentId,
        performedBy:     "system",
      });

      // Notify client with the meet link
      if (payload.callbackUrl) {
        await fetch(payload.callbackUrl, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status:    "created",
            meetLink:  result.hangoutLink,
            eventId:   result.eventId,
            createdAt: new Date(),
          }),
        }).catch((e: Error) => console.error("[crmWorker] Meeting callback failed:", e.message));
      }
      break;
    }

    // ── 4. Reminder — WhatsApp reminder before appointment ───────────────────
    case "crm.reminder": {
      const { createWhatsappService } = await import(
        "../../services/saas/whatsapp/whatsappService.ts"
      );
      const {
        getTenantConnection,
        getTenantModel,
      } = await import("../../lib/connectionManager.ts");
      const { schemas } = await import("../../model/saas/tenantSchemas.ts");

      const svc = createWhatsappService(globalIo);
      const tenantConn = await getTenantConnection(clientCode);
      const Conversation = getTenantModel(tenantConn, "Conversation", schemas.conversations);

      let conv = await Conversation.findOne({ clientCode, phone: payload.phone });
      if (!conv) {
        conv = await Conversation.create({
          clientCode,
          phone:    payload.phone,
          userName: payload.phone,
          status:   "open",
          channel:  "whatsapp",
        });
      }

      await svc.sendOutboundMessage(
        clientCode,
        conv._id.toString(),
        undefined, undefined, undefined,
        "system-reminder",
        payload.templateName,
        payload.language ?? "en_US",
        payload.variables ?? [],
      );

      // Log reminder to CRM timeline
      const { logActivity } = await import("../../services/saas/crm/activity.service.ts");
      if (payload.leadId) {
        await logActivity(clientCode, {
          leadId:      payload.leadId,
          type:        "whatsapp_sent",
          title:       `Reminder sent: ${payload.templateName}`,
          performedBy: "system-reminder",
        });
      }
      break;
    }

    // ── 5. Score refresh — background recalculation ──────────────────────────
    case "crm.score_refresh": {
      const { recalculateScore } = await import(
        "../../services/saas/crm/lead.service.ts"
      );
      await recalculateScore(clientCode, payload.leadId);
      break;
    }

    // ── 6. Webhook notify — fire HTTP callback to client server ──────────────
    case "crm.webhook_notify": {
      const res = await fetch(payload.callbackUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload.event),
      });
      if (!res.ok) {
        throw new Error(`Webhook notify failed [${res.status}]: ${payload.callbackUrl}`);
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
    concurrency:    3,        // process 3 jobs in parallel
    pollIntervalMs: 5_000,    // poll every 5 seconds
    baseBackoffMs:  10_000,   // retry with 10s base exponential backoff
  });
  worker.start();
  console.log("[crmWorker] ✅ Started — queue: crm, concurrency: 3, poll: 5s");
  return worker;
};
