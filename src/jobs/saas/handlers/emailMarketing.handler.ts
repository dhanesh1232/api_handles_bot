import { getCrmModels } from "@lib/tenant/crm.models";
import { mailClient } from "@services/mail/MailClient";
import { createNotification } from "@services/saas/crm/notification.service";
import { JobHandler } from "../base.handler";

export class EmailMarketingJobHandler extends JobHandler {
  /**
   * Individual worker unit for high-volume email marketing campaigns.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Context for a single recipient within a larger campaign.
   *
   * **DETAILED EXECUTION:**
   * 1. **Batch Unit Execution**: Dispatches one email to `MailClient`.
   * 2. **State Synchronization**: Atomically increments `sentCount` or `failedCount` in the parent `EmailCampaign` document.
   * 3. **Progress Tracking**: If the campaign hits 100% completion, updates the status to `completed` or `partially_failed`.
   * 4. **Real-time Reporting**: Emits progress percentage via Socket.io for live dashboard updates.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Final Notification: Triggers a "Campaign Finished" notification only when the VERY LAST recipient has been processed.
   * - Delivery Failures: Supresses individual notifications to prevent spamming the admin for 10,000 bad emails.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    const { campaignId, recipient, subject, html } = payload;
    const io = (global as any).io;
    const { EmailCampaign } = await getCrmModels(clientCode!);

    let success = false;

    try {
      const result = await mailClient.send({
        clientCode,
        to: recipient,
        subject,
        html,
        campaignId,
      });

      if (!result.success) {
        throw new Error(result.error || "Unknown delivery error");
      }

      success = true;
    } catch (err: any) {
      this.log.error(
        { recipient, err: err.message, campaignId },
        "Campaign email failed",
      );

      // We don't create a notification for EVERY failed email in a campaign (too noisy)
      // but we log it and update the campaign counter
    }

    const update: any = { $inc: {} };
    if (success) update.$inc.sentCount = 1;
    else update.$inc.failedCount = 1;

    const updatedCampaign = await EmailCampaign.findByIdAndUpdate(
      campaignId,
      update,
      { returnDocument: "after" },
    ).lean();

    if (updatedCampaign) {
      const totalProcessed =
        updatedCampaign.sentCount + updatedCampaign.failedCount;
      if (totalProcessed >= updatedCampaign.totalRecipients) {
        const finalStatus =
          updatedCampaign.failedCount > 0 ? "partially_failed" : "completed";
        await EmailCampaign.updateOne(
          { _id: campaignId },
          { $set: { status: finalStatus, completedAt: new Date() } },
        ).lean();
        updatedCampaign.status = finalStatus;
      }

      if (io) {
        io.to(clientCode).emit("email_campaign_progress", {
          campaignId,
          sentCount: updatedCampaign.sentCount,
          failedCount: updatedCampaign.failedCount,
          status: updatedCampaign.status,
        });

        if (
          updatedCampaign.status === "completed" ||
          updatedCampaign.status === "partially_failed"
        ) {
          io.to(clientCode).emit("email_campaign_completed", {
            campaignId,
            status: updatedCampaign.status,
            sentCount: updatedCampaign.sentCount,
            failedCount: updatedCampaign.failedCount,
          });

          // Final notification for the whole campaign
          await createNotification(clientCode, {
            title: "Email Campaign Finished",
            message: `Campaign "${updatedCampaign.name}" completed. Sent: ${updatedCampaign.sentCount}, Failed: ${updatedCampaign.failedCount}`,
            type: "info",
            status: "unread",
            actionData: { campaignId },
          });
        }
      }
    }
  }
}
