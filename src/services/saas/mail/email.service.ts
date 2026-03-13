import { ClientSecrets } from "@models/clients/secrets";
import { MailClient } from "@lib/mail/mail.client";
import { tenantLogger } from "@lib/logger";

/**
 * Email Marketing & Transactional Service
 */
export const createEmailService = () => {
  /**
   * Internal helper to get MailClient for a client
   */
  const getClient = async (clientCode: string) => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    return MailClient.fromSecrets(clientCode, secrets);
  };

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
    const log = tenantLogger(clientCode);
    try {
      const client = await getClient(clientCode);
      const result = await client.send({ to, subject, html, text });

      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      let friendlyError = error.message;

      if (error.code === "ENOTFOUND") {
        friendlyError = `SMTP Host not found: ${error.hostname}. Please check for typos.`;
      } else if (error.code === "ECONNREFUSED") {
        friendlyError = `Connection refused at ${error.address}:${error.port}.`;
      } else if (error.code === "ETIMEDOUT") {
        friendlyError = `Connection to SMTP server timed out.`;
      }

      log.error({ err: error, to, subject }, `Email failed: ${friendlyError}`);
      return { success: false, error: friendlyError };
    }
  };

  /**
   * Send Bulk/Marketing Campaign
   */
  const sendCampaign = async (
    clientCode: string,
    { recipients, subject, html }: CampaignDetails,
  ) => {
    const results = {
      total: recipients.length,
      success: 0,
      failed: 0,
      errors: [] as { recipient: string; error: any }[],
    };

    // Note: In a production environment with very large lists,
    // this should be offloaded to a background job.
    for (const recipient of recipients) {
      const res = await sendEmail(clientCode, { to: recipient, subject, html });
      if (res.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ recipient, error: res.error });
      }
    }

    return results;
  };

  return {
    sendEmail,
    sendCampaign,
  };
};
