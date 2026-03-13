import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { createEmailService } from "@services/saas/mail/email.service";

export class EmailJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    const svc = createEmailService();

    try {
      if (payload.bulk === true && Array.isArray(payload.recipients)) {
        await svc.sendCampaign(clientCode, {
          recipients: payload.recipients as string[],
          subject: payload.subject,
          html: payload.html,
        });
      } else {
        await svc.sendEmail(clientCode, {
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      }
    } catch (err: any) {
      this.log.error(
        { clientCode, recipient: payload.to || "bulk", err: err.message },
        "Email send failed",
      );
      const { createNotification } =
        await import("@services/saas/crm/notification.service");
      await createNotification(clientCode, {
        title: "Email Delivery Failed",
        message: `Failed to send email "${payload.subject}" to ${payload.to || "recipients"}: ${err.message}`,
        type: "alert",
        status: "unread",
        actionData: {
          error: err.message,
          actionConfig: { subject: payload.subject },
        },
      });
      throw err;
    }

    if (payload.callbackUrl) {
      const { sendCallbackWithRetry } = await import("@lib/callbackSender");
      void sendCallbackWithRetry({
        clientCode,
        callbackUrl: payload.callbackUrl,
        payload: { status: "sent", sentAt: new Date() },
        jobId: job._id?.toString(),
      });
    }
  }
}
