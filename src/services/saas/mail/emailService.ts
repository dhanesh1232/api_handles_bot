import nodemailer from "nodemailer";
import { ClientSecrets } from "../../../model/clients/secrets.ts";

/**
 * Email Marketing & Transactional Service
 */

interface EmailDetails {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

interface CampaignDetails {
  recipients: string[];
  subject: string;
  html: string;
}

export const createEmailService = () => {
  /**
   * Get SMTP Transporter for a client
   */
  const getTransporter = async (clientCode: string) => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    const host = secrets.getDecrypted("smtpHost");
    const port = secrets.getDecrypted("smtpPort") || 587;
    const user = secrets.getDecrypted("smtpUser");
    const pass = secrets.getDecrypted("smtpPass");
    const fromName =
      secrets.getDecrypted("emailFromName") || "Business Support";

    if (!host || !user || !pass) {
      throw new Error("SMTP credentials not configured for this client");
    }

    return {
      transporter: nodemailer.createTransport({
        host: host as string,
        port: Number(port),
        secure: Number(port) === 465,
        auth: {
          user: user as string,
          pass: pass as string,
        },
      }),
      from: `"${fromName}" <${user}>`,
    };
  };

  /**
   * Send a single email
   */
  const sendEmail = async (clientCode: string, { to, subject, html, text }: EmailDetails) => {
    try {
      const { transporter, from } = await getTransporter(clientCode);

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error(`❌ Email Error [${clientCode}]:`, error.message);
      return { success: false, error: error.message };
    }
  };

  /**
   * Send Bulk/Marketing Campaign
   */
  const sendCampaign = async (clientCode: string, { recipients, subject, html }: CampaignDetails) => {
    const results = {
      total: recipients.length,
      success: 0,
      failed: 0,
      errors: [] as { recipient: string; error: any }[],
    };

    // Use a small delay between emails to avoid spam filters if sending many
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
