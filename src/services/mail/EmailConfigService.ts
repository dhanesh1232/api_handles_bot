import { type EmailProvider, PROVIDER_CONFIG } from "@/config/emailProviders";
import { ClientSecrets } from "@/model/clients/secrets";
import { emailHealthService } from "./EmailHealthService.ts";
import { mailClient } from "./MailClient.ts";
import {
  createDomainIdentity,
  deleteDomainIdentity,
  getDomainVerificationStatus,
} from "./providers/SesProvider.ts";
import { testSmtpConnection } from "./providers/SmtpProvider.ts";

class EmailConfigService {
  /**
   * Get current config + provider metadata for UI
   */
  async getConfig(clientCode: string) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    let currentProvider = (secrets.emailProvider || "ses") as EmailProvider;
    const isSupported = !!PROVIDER_CONFIG[currentProvider];

    if (!isSupported) {
      currentProvider = "ses";
    }

    const providerConfig = PROVIDER_CONFIG[currentProvider];
    const health = await emailHealthService.getHealthSummary(clientCode);

    // Calculate onboarding step
    let onboardingStep:
      | "domain_setup"
      | "dns_pending"
      | "email_config"
      | "active" = "domain_setup";

    if (secrets.sesDomain) {
      if (!secrets.sesVerified) {
        onboardingStep = "dns_pending";
      } else if (!secrets.getDecrypted("sesFromEmail")) {
        onboardingStep = "email_config";
      } else {
        onboardingStep = "active";
      }
    }

    return {
      currentProvider,
      onboardingStep,
      isConfigured: !!secrets.emailProvider && isSupported,
      sesVerified: secrets.sesVerified || false,
      sesDomain: secrets.sesDomain || null,
      sesDnsRecords: secrets.sesDnsRecords || [],
      emailFromName: secrets.getDecrypted("emailFromName") || null,
      sesFromEmail: secrets.getDecrypted("sesFromEmail") || null,
      sesReplyTo: secrets.getDecrypted("sesReplyTo") || null,
      smtpHost: secrets.getDecrypted("smtpHost") || null,
      smtpPort: secrets.smtpPort || null,
      smtpUser: secrets.getDecrypted("smtpUser") || null,
      smtpFromEmail: secrets.getDecrypted("smtpFromEmail") || null,
      smtpFromName: secrets.getDecrypted("smtpFromName") || null,
      smtpSecure: secrets.smtpSecure || false,
      // Advanced
      emailFooter: secrets.getDecrypted("emailFooter") || null,
      emailCc: secrets.getDecrypted("emailCc") || null,
      emailBcc: secrets.getDecrypted("emailBcc") || null,
      dailyLimit: secrets.dailyLimit || 0,
      currentDayCount: secrets.currentDayCount || 0,
      providerConfig,
      allProviders: PROVIDER_CONFIG,
      health,
    };
  }

  /**
   * Switch provider
   */
  async switchProvider(clientCode: string, provider: EmailProvider) {
    await ClientSecrets.findOneAndUpdate(
      { clientCode },
      { $set: { emailProvider: provider } },
    );

    const config = PROVIDER_CONFIG[provider];
    return {
      success: true,
      requiredFields: config.requiredFields,
      warningMessage: config.warningMessage,
    };
  }

  /**
   * Save SMTP config
   */
  async saveSmtpConfig(
    clientCode: string,
    config: {
      provider: EmailProvider;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser: string;
      smtpPass: string;
      smtpFromEmail: string;
      smtpFromName: string;
      smtpSecure?: boolean;
    },
  ) {
    // 1. Get host based on provider
    const fixedHosts: Record<string, string> = {
      gmail_smtp: "smtp.gmail.com",
      zoho_smtp: "smtp.zoho.in",
      outlook_smtp: "smtp.office365.com",
    };
    const host = fixedHosts[config.provider] || config.smtpHost;
    if (!host) throw new Error("SMTP Host is required");

    const smtpConfig = {
      host,
      port: config.smtpPort || 587,
      user: config.smtpUser,
      pass: config.smtpPass,
      secure: config.smtpSecure || false,
    };

    // 2. Test connection BEFORE saving
    const connectionTest = await testSmtpConnection(smtpConfig);
    if (!connectionTest.success) {
      return { success: false, connectionTest };
    }

    // 3. Save to ClientSecrets
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    secrets.emailProvider = config.provider;
    secrets.smtpHost = host;
    secrets.smtpPort = smtpConfig.port.toString();
    secrets.smtpUser = config.smtpUser;
    secrets.smtpPass = config.smtpPass;
    secrets.smtpFromEmail = config.smtpFromEmail;
    secrets.smtpFromName = config.smtpFromName;
    secrets.smtpSecure = config.smtpSecure;

    await secrets.save();

    return { success: true, connectionTest };
  }

  /**
   * Save Advanced Marketing Config
   */
  async saveAdvancedConfig(
    clientCode: string,
    config: {
      emailFooter?: string;
      emailCc?: string;
      emailBcc?: string;
      dailyLimit?: number;
    },
  ) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    if (config.emailFooter !== undefined)
      secrets.emailFooter = config.emailFooter;
    if (config.emailCc !== undefined) secrets.emailCc = config.emailCc;
    if (config.emailBcc !== undefined) secrets.emailBcc = config.emailBcc;
    if (config.dailyLimit !== undefined) secrets.dailyLimit = config.dailyLimit;

    await secrets.save();
    return { success: true };
  }

  /**
   * METHOD 1 — Domain only (Step 1)
   */
  async initDomainVerification(
    clientCode: string,
    domain: string,
  ): Promise<{
    success: boolean;
    dnsRecords: Array<{
      type: string;
      name: string;
      value: string;
      description: string;
    }>;
    message: string;
  }> {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    if (secrets.sesVerified) {
      throw new Error(
        "Domain already verified. Proceed to email configuration.",
      );
    }

    const { dnsRecords } = await createDomainIdentity(domain);

    secrets.sesDomain = domain;
    secrets.sesVerified = false;
    secrets.sesVerifiedAt = undefined;
    secrets.sesDnsRecords = dnsRecords;
    secrets.emailProvider = undefined; // Step 1: NOT set yet
    secrets.sesFromEmail = undefined; // Step 1: NOT set yet
    secrets.isConfigured = false;

    await secrets.save();

    return {
      success: true,
      dnsRecords,
      message:
        "Add these 4 DNS records to your domain, then click Check Verification",
    };
  }

  /**
   * METHOD 2 — Email config (Step 3 — only after verified)
   */
  async saveEmailConfig(
    clientCode: string,
    config: {
      fromName: string;
      fromEmail: string;
      replyTo?: string;
    },
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    // GATE CHECK — sesVerified must be true
    if (!secrets.sesVerified) {
      throw new Error(
        "Domain not verified yet. " +
          "Complete DNS verification before configuring email.",
      );
    }

    // DOMAIN MATCH CHECK
    const fromDomain = config.fromEmail.split("@")[1];
    if (fromDomain !== secrets.sesDomain) {
      throw new Error(
        `From email must use your verified domain. ` +
          `Expected: @${secrets.sesDomain}, ` +
          `Got: @${fromDomain}`,
      );
    }

    secrets.emailFromName = config.fromName;
    secrets.sesFromEmail = config.fromEmail;
    secrets.sesReplyTo = config.replyTo || null;
    secrets.emailProvider = "ses"; // Step 3: Now active

    await secrets.save();

    return {
      success: true,
      message: "Email configured. Sending is now active.",
    };
  }

  /**
   * Check SES verification status
   */
  async checkSesVerification(clientCode: string) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets?.sesDomain) throw new Error("No SES domain configured");

    const { verified, dkimStatus, mailFromStatus } =
      await getDomainVerificationStatus(secrets.sesDomain);

    if (verified) {
      await ClientSecrets.findOneAndUpdate(
        { clientCode },
        {
          $set: {
            sesVerified: true,
            sesVerifiedAt: new Date(),
          },
        },
      );
    }

    return { verified, dkimStatus, mailFromStatus };
  }

  /**
   * Remove SES domain
   */
  async removeSesIdentity(clientCode: string) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (secrets?.sesDomain) {
      await deleteDomainIdentity(secrets.sesDomain);
    }

    await ClientSecrets.findOneAndUpdate(
      { clientCode },
      {
        $set: {
          sesDomain: null,
          sesDnsRecords: [],
          sesVerified: false,
          sesVerifiedAt: null,
        },
      },
    );
  }

  /**
   * Test current provider
   */
  async sendTestEmail(clientCode: string, toEmail: string) {
    return await mailClient.send({
      clientCode,
      to: toEmail,
      subject: "ECODrIx Email Configuration Test",
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Email Configuration Successful!</h2>
          <p>This is a test email from your ECODrIx SaaS platform.</p>
          <p>Your current provider is functioning correctly.</p>
        </div>
      `,
      text: "Email Configuration Successful! This is a test email from ECODrIx.",
    });
  }
  /**
   * Migration helper: append DMARC record for existing clients set up before DMARC support
   */
  async addMissingDmarcRecord(clientCode: string) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets?.sesDomain)
      throw new Error("No SES domain configured for this client");

    const existing = (secrets.sesDnsRecords || []) as Array<{
      type: string;
      name: string;
      value: string;
      description?: string;
    }>;
    const hasDmarc = existing.some((r) => r.name?.startsWith("_dmarc."));

    const dmarcRecord = {
      type: "TXT",
      name: `_dmarc.${secrets.sesDomain}`,
      value: '"v=DMARC1; p=none;"',
      description: "DMARC policy record",
    };

    if (!hasDmarc) {
      await ClientSecrets.findOneAndUpdate(
        { clientCode },
        { $push: { sesDnsRecords: dmarcRecord } },
      );
    }

    return { dmarcRecord, alreadyPresent: hasDmarc };
  }
}

export const emailConfigService = new EmailConfigService();
