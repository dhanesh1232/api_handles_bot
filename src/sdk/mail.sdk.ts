/**
 * sdk/mail.sdk.ts
 *
 * MailSDK — High-level facade for sending emails.
 * Handles secret retrieval internally.
 */

import { mailClient } from "@services/mail/MailClient";

export class MailSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Send a single email.
   */
  async send(input: SendMailInput) {
    return mailClient.send({
      ...input,
      clientCode: this.clientCode,
    });
  }

  /**
   * Send a campaign/bulk email.
   * Simple loop for now, but benefits from MailClient's pool.
   */
  async sendBulk(recipients: string[], subject: string, html: string) {
    const results = {
      total: recipients.length,
      success: 0,
      failed: 0,
      errors: [] as { recipient: string; error: any }[],
    };

    for (const recipient of recipients) {
      const res = await this.send({ to: recipient, subject, html });
      if (res.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ recipient, error: res.error });
      }
    }

    return results;
  }
}
