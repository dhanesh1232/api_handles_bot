/**
 * sdk/mail.sdk.ts
 *
 * MailSDK — High-level facade for sending emails.
 * Handles secret retrieval internally.
 */

import { dbConnect } from "@lib/config";
import { MailClient } from "@lib/mail/mail.client";
import { ClientSecrets } from "@models/clients/secrets";

export class MailSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Internal helper to get decrypted SMTP secrets and init client.
   */
  private async getClient() {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({
      clientCode: this.clientCode,
    });
    if (!secrets)
      throw new Error(`Secrets not found for client: ${this.clientCode}`);

    return MailClient.fromSecrets(this.clientCode, secrets);
  }

  /**
   * Send a single email.
   */
  async send(input: SendMailInput) {
    const client = await this.getClient();
    return client.send(input);
  }

  /**
   * Send a campaign/bulk email.
   * Simple loop for now, but benefits from MailClient's pool.
   */
  async sendBulk(recipients: string[], subject: string, html: string) {
    const client = await this.getClient();
    const results = {
      total: recipients.length,
      success: 0,
      failed: 0,
      errors: [] as { recipient: string; error: any }[],
    };

    for (const recipient of recipients) {
      try {
        await client.send({ to: recipient, subject, html });
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ recipient, error: err.message });
      }
    }

    client.close(); // Clean up pool
    return results;
  }
}
