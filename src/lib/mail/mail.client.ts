/**
 * lib/mail/mail.client.ts
 *
 * MailClient — A class-based wrapper for Nodemailer to handle SMTP statefully.
 * Each instance is bound to a specific client's SMTP credentials.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@lib/logger";

export interface MailOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  secure?: boolean;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export class MailClient {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly clientCode: string;
  private readonly log = logger.child({ module: "MailClient" });

  constructor(clientCode: string, options: MailOptions) {
    this.clientCode = clientCode;
    this.from = `"${options.fromName}" <${options.fromEmail}>`;

    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      auth: {
        user: options.user,
        pass: options.pass,
      },
      // Optimization: use pool for multiple sends if needed
      pool: true,
      maxConnections: 5,
    });
  }

  /**
   * Factory to create a client from a secrets object.
   */
  static fromSecrets(
    clientCode: string,
    secrets: {
      getDecrypted: (key: string) => string | null | undefined;
      smtpSecure?: boolean;
    },
  ): MailClient {
    const host = secrets.getDecrypted("smtpHost");
    const port = secrets.getDecrypted("smtpPort");
    const user = secrets.getDecrypted("smtpUser");
    const pass = secrets.getDecrypted("smtpPass");
    const fromName =
      secrets.getDecrypted("emailFromName") || "Business Support";
    const fromEmail = secrets.getDecrypted("smtpFrom") || (user as string);

    if (!host || !user || !pass) {
      throw new Error(`SMTP configuration missing for client: ${clientCode}`);
    }

    return new MailClient(clientCode, {
      host: host as string,
      port: Number(port || 587),
      user: user as string,
      pass: pass as string,
      fromName,
      fromEmail,
      secure: secrets.smtpSecure,
    });
  }

  /**
   * Send a single email.
   */
  async send(input: SendMailInput): Promise<{ messageId: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      this.log.debug(
        {
          messageId: info.messageId,
          to: input.to,
          clientCode: this.clientCode,
        },
        "Email sent",
      );
      return { messageId: info.messageId };
    } catch (err) {
      this.log.error(
        { err, to: input.to, clientCode: this.clientCode },
        "Failed to send email",
      );
      throw err;
    }
  }

  /**
   * Close the connection pool.
   */
  close(): void {
    this.transporter.close();
  }
}
