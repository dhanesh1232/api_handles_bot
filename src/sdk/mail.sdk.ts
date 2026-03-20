/**
 * @file mail.sdk.ts
 * @module MailSDK
 * @responsibility High-level facade for sending transactional and bulk emails.
 * @dependencies MailClient
 */

import { mailClient } from "@services/mail/MailClient";

export class MailSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Dispatches a single transactional email.
   *
   * **WORKING PROCESS:**
   * 1. Merges the provided `clientCode` into the input (used for SMTP credential lookup).
   * 2. Delegates to the global `mailClient.send`.
   * 3. The client handles provider switching (SendGrid, Postmark, etc.) based on tenant config.
   *
   * @param {SendMailInput} input - Recipient, subject, body (HTML/Text).
   * @returns {Promise<any>}
   * @edge_case Falls back to a global provider if the tenant hasn't configured their own SMTP.
   */
  async send(input: SendMailInput) {
    return mailClient.send({
      ...input,
      clientCode: this.clientCode,
    });
  }

  /**
   * Sends a campaign or bulk email to multiple recipients.
   *
   * **WORKING PROCESS:**
   * 1. Initializes a tracking object for success/fail counts.
   * 2. Iterates through the `recipients` list.
   * 3. Calls `this.send()` for each recipient.
   * 4. Aggregates results and captures specific errors for debugging.
   *
   * @param {string[]} recipients - List of destination addresses.
   * @param {string} subject - Email subject line.
   * @param {string} html - HTML email body.
   * @returns {Promise<any>} Summary of bulk operation results.
   * @edge_case Currently sequential; large lists should ideally be offloaded to a background job.
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
