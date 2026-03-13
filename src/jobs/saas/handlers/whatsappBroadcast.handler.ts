import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { createWhatsappService } from "@services/saas/whatsapp/whatsapp.service";
import { getCrmModels } from "@lib/tenant/crm.models";
import { normalizePhone } from "@utils/phone";
import { createNotification } from "@services/saas/crm/notification.service";

export class WhatsAppBroadcastJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    const { broadcastId, phone, templateName, templateLanguage, variables } =
      payload;
    const io = (global as any).io;
    const svc = createWhatsappService(io);
    const {
      Broadcast,
      Conversation,
      conn: tenantConn,
    } = await getCrmModels(clientCode);

    let success = false;
    const normalizedPhone = normalizePhone(phone);

    try {
      let conv = await Conversation.findOne({ phone: normalizedPhone }).lean();
      if (!conv) {
        const newConv = await Conversation.create({
          phone: normalizedPhone,
          userName: "Customer",
          status: "open",
          channel: "whatsapp",
          unreadCount: 0,
        });
        conv = newConv.toObject();
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
      this.log.error({ phone, err: err.message }, "Broadcast send failed");
      await createNotification(clientCode, {
        title: "Broadcast Failed",
        message: `Failed to send broadcast ${templateName} to ${phone}: ${err.message}`,
        type: "alert",
        status: "unread",
        actionData: {
          error: err.message,
          actionConfig: { templateName, variables },
        },
      });
    }

    const update: any = { $inc: {} };
    if (success) update.$inc.sentCount = 1;
    else update.$inc.failedCount = 1;

    const updatedBroadcast = await Broadcast.findByIdAndUpdate(
      broadcastId,
      update,
      { returnDocument: "after" },
    ).lean();

    if (updatedBroadcast) {
      const totalProcessed =
        updatedBroadcast.sentCount + updatedBroadcast.failedCount;
      if (totalProcessed >= updatedBroadcast.totalRecipients) {
        const finalStatus =
          updatedBroadcast.failedCount > 0 ? "partially_failed" : "completed";
        await Broadcast.updateOne(
          { _id: broadcastId },
          { $set: { status: finalStatus, completedAt: new Date() } },
        ).lean();
        // Update local object for socket emission
        updatedBroadcast.status = finalStatus;
      }

      if (io) {
        io.to(clientCode).emit("broadcast_progress", {
          broadcastId,
          sentCount: updatedBroadcast.sentCount,
          failedCount: updatedBroadcast.failedCount,
          status: updatedBroadcast.status,
        });
      }
    }
  }
}
