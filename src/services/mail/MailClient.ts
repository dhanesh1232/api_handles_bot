import { logger } from "@lib/logger";
import { ClientSecrets, type IClientSecrets } from "@/model/clients/secrets";
import { emailHealthService } from "./EmailHealthService.ts";
import { sendViaSES } from "./providers/SesProvider.ts";
import { sendViaSMTP } from "./providers/SmtpProvider.ts";

interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  clientCode: string;
  campaignId?: string;
  headers?: Record<string, string>;
}

interface MailResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

function validateMailOptions(options: MailOptions): void {
  if (!options.to) {
    throw new Error("Recipient email is required");
  }
  if (!options.subject?.trim()) {
    throw new Error("Email subject is required");
  }
  if (!options.html?.trim()) {
    throw new Error("Email body (html) is required");
  }
  if (Array.isArray(options.to) && options.to.length > 50) {
    throw new Error(
      "Max 50 recipients per send call. " +
        "Split into batches for bulk sending.",
    );
  }
  if (typeof options.to === "string" && !options.to.includes("@")) {
    throw new Error(`Invalid recipient email: ${options.to}`);
  }
}

class MailClient {
  /**
   * Universal engine for dispatching emails across SES and SMTP providers.
   *
   * **WORKING PROCESS:**
   * 1. Validation: Enforces recipient format and batch size limits (max 50).
   * 2. Secrets Resolution: Fetches encrypted tenant SMTP/SES credentials.
   * 3. Routing: Dynamically selects the provider (SES, Generic SMTP, or specific hosts like Gmail/Zoho).
   * 4. Verification Gates: Validates domain verification (`sesVerified`) and from-email alignment before execution.
   * 5. Quota Guard: Enforces `dailyLimit` and handles automatic 24-hour counter resets.
   * 6. Enrichment: Appends custom branding footers and standard headers (Unsubscribe, Campaign-ID).
   * 7. Health Sync: Records success/failure metrics via `EmailHealthService` for adaptive routing or user alerts.
   *
   * **EDGE CASES:**
   * - Limit Reached: Gracefully returns a failure object if the tenant's daily quota is exhausted.
   * - Domain Mismatch: Blocks SES sends if the "From" domain doesn't match the verified AWS domain.
   * - Provider Error: Catches provider-specific exceptions (e.g., authentication failed) and updates health status.
   *
   * @param {MailOptions} options - Recipient, content, and tenant context.
   * @returns {Promise<MailResult>} Detailed result including provider and message ID.
   */
  async send(options: MailOptions): Promise<MailResult> {
    validateMailOptions(options);

    // 1. Fetch tenant secrets
    const secrets = await ClientSecrets.findOne({
      clientCode: options.clientCode,
    });
    if (!secrets) throw new Error(`Client ${options.clientCode} not found`);

    const provider = (secrets.emailProvider || "ses") as string;
    let result: MailResult;

    try {
      // 2. Route to correct provider
      switch (provider) {
        case "ses": {
          // Gate 1 — domain must be verified
          if (!secrets.sesVerified) {
            throw new Error(
              "Email domain not verified. " +
                "Complete DNS setup in Settings → Email Infrastructure.",
            );
          }

          // Gate 2 — email must be configured
          const fromEmail = secrets.getDecrypted("sesFromEmail");
          if (!fromEmail) {
            throw new Error(
              "From email not configured. " +
                "Complete email setup in Settings → Email Infrastructure.",
            );
          }

          // Gate 3 — domain match (runtime safety)
          const fromDomain = fromEmail.split("@")[1];
          if (fromDomain !== secrets.sesDomain) {
            throw new Error(
              `From email domain mismatch. ` +
                `Configured: @${fromDomain}, ` +
                `Verified: @${secrets.sesDomain}`,
            );
          }

          const from = `${secrets.getDecrypted("emailFromName") || "Support"} <${fromEmail}>`;
          const replyTo = secrets.getDecrypted("sesReplyTo") || undefined;

          // 5. Throttling & Compliance Checks
          const dailyLimit = secrets.dailyLimit || 0;
          const currentCount = secrets.currentDayCount || 0;
          const now = new Date();
          const lastReset = secrets.lastCountReset || new Date(0);

          // Reset counter if it's a new day
          const isNewDay = now.toDateString() !== lastReset.toDateString();
          const effectiveCount = isNewDay ? 0 : currentCount;

          if (dailyLimit > 0 && effectiveCount >= dailyLimit) {
            result = {
              success: false,
              error: `Daily send limit reached (${dailyLimit}). Reset at midnight.`,
              provider,
            };
            break;
          }

          // Apply Global Compliance & Customization
          const globalCc = secrets.getDecrypted("emailCc");
          const globalBcc = secrets.getDecrypted("emailBcc");
          const customFooter = secrets.getDecrypted("emailFooter");

          if (customFooter) {
            options.html = `${options.html}<br/><hr/><div style="font-size: 12px; color: #666;">${customFooter}</div>`;
          }

          const customHeaders: Record<string, string> = {
            "List-Unsubscribe": `<mailto:unsubscribe@${fromDomain}?subject=unsubscribe>`,
            "X-Campaign-ID": options.campaignId || "transactional",
            ...(options.headers || {}),
          };

          if (globalCc) customHeaders.Cc = globalCc;
          if (globalBcc) customHeaders.Bcc = globalBcc;

          // 6. Send based on provider
          const { messageId } = await sendViaSES({
            ...options,
            from,
            replyTo,
            cc: globalCc || undefined,
            bcc: globalBcc || undefined,
            headers: customHeaders,
          });
          result = { success: true, messageId, provider: "ses" };
          break;
        }

        case "smtp":
        case "gmail_smtp":
        case "zoho_smtp":
        case "outlook_smtp": {
          const smtpConfig = {
            host: this.getSmtpHost(provider, secrets),
            port: parseInt(secrets.smtpPort || "587", 10),
            user: secrets.getDecrypted("smtpUser") || "",
            pass: secrets.getDecrypted("smtpPass") || "",
            secure: secrets.smtpSecure || false,
          };
          const from = `${secrets.getDecrypted("smtpFromName") || secrets.getDecrypted("emailFromName") || "Support"} <${secrets.getDecrypted("smtpFromEmail")}>`;

          // 5. Throttling & Compliance Checks
          const dailyLimit = secrets.dailyLimit || 0;
          const currentCount = secrets.currentDayCount || 0;
          const now = new Date();
          const lastReset = secrets.lastCountReset || new Date(0);

          // Reset counter if it's a new day
          const isNewDay = now.toDateString() !== lastReset.toDateString();
          const effectiveCount = isNewDay ? 0 : currentCount;

          if (dailyLimit > 0 && effectiveCount >= dailyLimit) {
            result = {
              success: false,
              error: `Daily send limit reached (${dailyLimit}). Reset at midnight.`,
              provider,
            };
            break;
          }

          // Apply Global Compliance & Customization
          const globalCc = secrets.getDecrypted("emailCc");
          const globalBcc = secrets.getDecrypted("emailBcc");
          const customFooter = secrets.getDecrypted("emailFooter");

          if (customFooter) {
            options.html = `${options.html}<br/><hr/><div style="font-size: 12px; color: #666;">${customFooter}</div>`;
          }

          const customHeaders: Record<string, string> = {
            "List-Unsubscribe": `<mailto:unsubscribe@${smtpConfig.host}?subject=unsubscribe>`,
            "X-Campaign-ID": options.campaignId || "transactional",
            ...(options.headers || {}),
          };

          if (globalCc) customHeaders.Cc = globalCc;
          if (globalBcc) customHeaders.Bcc = globalBcc;

          // 6. Send based on provider
          const { messageId } = await sendViaSMTP({
            ...options,
            from,
            smtpConfig,
            cc: globalCc || undefined,
            bcc: globalBcc || undefined,
            headers: customHeaders,
          });
          result = { success: true, messageId, provider };
          break;
        }

        default:
          result = {
            success: false,
            error: `Unsupported provider: ${provider}`,
            provider,
          };
      }

      // Update stats on success
      if (result.success) {
        const dailyLimit = secrets.dailyLimit || 0;
        const currentCount = secrets.currentDayCount || 0;
        const now = new Date();
        const lastReset = secrets.lastCountReset || new Date(0);

        const isNewDay = now.toDateString() !== lastReset.toDateString();
        const effectiveCount = isNewDay ? 0 : currentCount;

        await ClientSecrets.updateOne(
          { clientCode: options.clientCode },
          {
            $set: {
              currentDayCount: effectiveCount + 1,
              lastCountReset: now,
            },
          },
        );
      }

      // 3. Record success
      if (result.success) {
        await emailHealthService.recordSuccess(options.clientCode);
      }

      // 4. Log
      logger.info({
        module: "MailClient",
        provider,
        messageId: result.messageId,
        to: options.to,
        clientCode: options.clientCode,
        msg: "Email sent successfully",
      });

      return result;
    } catch (err: any) {
      // 5. Record failure
      await emailHealthService.recordFailure(options.clientCode, err.message);

      // 6. Log failure
      logger.error({
        module: "MailClient",
        provider,
        error: err.message,
        to: options.to,
        clientCode: options.clientCode,
        msg: "Email send failed",
      });

      return {
        success: false,
        provider,
        error: err.message,
      };
    }
  }

  // Helper — gmail/zoho/outlook have fixed hosts
  private getSmtpHost(provider: string, secrets: IClientSecrets): string {
    const fixedHosts: Record<string, string> = {
      gmail_smtp: "smtp.gmail.com",
      zoho_smtp: "smtp.zoho.in",
      outlook_smtp: "smtp.office365.com",
    };
    return fixedHosts[provider] || secrets.smtpHost || "";
  }
}

export const mailClient = new MailClient();
