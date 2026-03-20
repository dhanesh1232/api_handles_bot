import { ErixJobs } from "@lib/erixJobs";
import { getCrmModels } from "@lib/tenant/crm.models";
import { mailClient } from "@services/mail/MailClient";

interface EmailDetails {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email Marketing & Transactional Service
 */
export const createEmailService = () => {
  /**
   * Internal helper to get MailClient for a client
   * @deprecated Use unified mailClient directly
   */

  /**
   * Dispatches a single transactional or scheduled email.
   *
   * **WORKING PROCESS:**
   * 1. Proxies the request to the unified `mailClient`.
   * 2. Automatically attaches the `clientCode` for tenant-specific SMTP/API routing.
   * 3. Handles both HTML and plain-text fallbacks.
   *
   * **EDGE CASES:**
   * - Provider Failure: Catches transport errors and returns a `success: false` object rather than throwing.
   * - Invalid Recipient: If the 'to' address is malformed, the provider will reject; results in error return.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {EmailDetails} details - Recipient, subject, and content.
   * @returns {Promise<object>} Result from the mail provider.
   */
  const sendEmail = async (
    clientCode: string,
    { to, subject, html, text }: EmailDetails,
  ) => {
    try {
      const result = await mailClient.send({
        to,
        subject,
        html,
        text,
        clientCode,
      });

      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Initiates a bulk email campaign for multiple recipients.
   *
   * **WORKING PROCESS:**
   * 1. Record Creation: Persists an `EmailCampaign` document to track global progress and analytics.
   * 2. Job Distribution: Iterates through recipients and pushes individual "crm.email_marketing" jobs to Redis (Bull).
   * 3. Background Processing: The `crmWorker` picks up these jobs and calls `sendEmail` for each recipient.
   *
   * **EDGE CASES:**
   * - Large Lists: Queueing thousands of jobs is offloaded to the worker to prevent API timeout.
   * - Duplicate Campaign: Does not prevent re-sending; creates a new record for each call.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {object} options - Campaign metadata and list of recipients.
   * @returns {Promise<object>} Summary of the queued campaign.
   */
  const sendCampaign = async (
    clientCode: string,
    options: {
      name?: string;
      recipients: string[];
      subject: string;
      html: string;
      text?: string;
    },
  ) => {
    const { EmailCampaign } = await getCrmModels(clientCode);

    // 1. Create Campaign Record
    const campaign = await EmailCampaign.create({
      name: options.name || `Campaign - ${new Date().toISOString()}`,
      subject: options.subject,
      html: options.html,
      status: "processing",
      totalRecipients: options.recipients.length,
    });

    // 2. Queue jobs for each recipient
    const queue = ErixJobs.getQueue("crm.email_marketing");
    for (const recipient of options.recipients) {
      await queue.add(clientCode, {
        campaignId: campaign._id,
        recipient,
        subject: options.subject,
        html: options.html,
      });
    }

    return {
      success: true,
      campaignId: campaign._id,
      totalQueued: options.recipients.length,
    };
  };

  return {
    sendEmail,
    sendCampaign,
  };
};
