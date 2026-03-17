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
   * Send a single email
   * @param clientCode - The client code
   * @param to - The recipient email address
   * @param subject - The email subject
   * @param html - The email HTML content
   * @param text - The email text content
   * @returns The email result
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
   * Send Bulk/Marketing Campaign
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
      await queue.add({
        clientCode,
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
