import { createEmailService } from "@services/saas/mail/email.service";
import { JobHandler } from "../base.handler";

export class EmailJobHandler extends JobHandler {
  /**
   * Processes outbound email delivery for transactional and bulk (one-off) requests.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Message data (`to`, `subject`, `html`, `text`) and orchestration flags (`bulk`, `callbackUrl`).
   * @param job - Job instance for traceability.
   *
   * **DETAILED EXECUTION:**
   * 1. **Mode Detection**: Switches between single `sendEmail` or batch `sendCampaign` based on the `bulk` flag.
   * 2. **Provider Handshake**: Routes the request to the configured SMTP or SES provider.
   * 3. **Success Callback**: If `callbackUrl` is provided, notifies the initiating microservice of successful delivery.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Failure Notification: If the provider rejects the email, creates a system notification for the tenant to investigate (e.g., bounced address).
   */
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
      const { createNotification } = await import(
        "@services/saas/crm/notification.service"
      );
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
