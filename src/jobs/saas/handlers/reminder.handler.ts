import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { createWhatsappService } from "@services/saas/whatsapp/whatsapp.service";
import { getCrmModels } from "@lib/tenant/crm.models";
import { normalizePhone } from "@utils/phone";
import { logActivity } from "@services/saas/crm/activity.service";
import { createNotification } from "@services/saas/crm/notification.service";

export class ReminderJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    // Note: globalIo is typically injected via worker registration
    const io = (global as any).io;
    const svc = createWhatsappService(io);
    const { Conversation, conn: tenantConn } = await getCrmModels(clientCode);

    const phone = normalizePhone(payload.phone);
    let conv = await Conversation.findOne({ phone }).lean();
    if (!conv) {
      const newConv = await Conversation.create({
        phone,
        userName: phone,
        status: "open",
        channel: "whatsapp",
      });
      conv = newConv.toObject();
    }

    let finalVariables = payload.variables || [];
    let templateLanguage = payload.language || "en_US";

    try {
      const { resolveUnifiedWhatsAppTemplate } =
        await import("@services/saas/whatsapp/template.service");
      const { Lead } = await getCrmModels(clientCode);

      const lead = payload.leadId
        ? await Lead.findById(payload.leadId).lean()
        : {};

      const resolution = await resolveUnifiedWhatsAppTemplate(
        tenantConn,
        payload.templateName,
        lead || {},
        payload.variables || {},
      );

      finalVariables = resolution.resolvedVariables;
      templateLanguage = resolution.languageCode;
    } catch (err: any) {
      this.log.warn(
        { templateName: payload.templateName, err: err.message },
        "Reminder resolution fallback",
      );
    }

    try {
      await svc.sendOutboundMessage(
        clientCode,
        conv._id.toString(),
        undefined,
        undefined,
        undefined,
        "system-reminder",
        payload.templateName,
        templateLanguage,
        finalVariables,
      );
    } catch (err: any) {
      this.log.error(
        { clientCode, phone, err: err.message },
        "Reminder send failed",
      );
      await createNotification(clientCode, {
        title: "Reminder Failed",
        message: `Failed to send reminder ${payload.templateName} to ${phone}: ${err.message}`,
        type: "alert",
        status: "unread",
        actionData: {
          leadId: payload.leadId,
          error: err.message,
          actionConfig: {
            templateName: payload.templateName,
            variables: payload.variables,
          },
        },
      });
      throw err;
    }

    if (payload.leadId) {
      await logActivity(clientCode, {
        leadId: payload.leadId,
        type: "whatsapp_sent",
        title: `Reminder sent: ${payload.templateName}`,
        performedBy: "system-reminder",
      });
    }
  }
}
