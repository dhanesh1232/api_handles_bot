import { PROVIDER_CONFIG } from "../../config/emailProviders.ts";
import { ClientSecrets } from "../../model/clients/secrets.ts";

class EmailHealthService {
  /**
   * Call this after every successful send
   */
  async recordSuccess(clientCode: string): Promise<void> {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) return;

    const totalSent = (secrets.emailStats?.totalSent || 0) + 1;
    const totalFailed = secrets.emailStats?.totalFailed || 0;
    const failureRate = (totalFailed / (totalSent + totalFailed)) * 100;

    let status: "healthy" | "degraded" | "failing" | "unconfigured" = "healthy";
    if (failureRate > 20) {
      status = "failing";
    } else if (failureRate > 5) {
      status = "degraded";
    }

    await ClientSecrets.findOneAndUpdate(
      { clientCode },
      {
        $set: {
          "emailStats.totalSent": totalSent,
          "emailStats.lastSentAt": new Date(),
          "emailStats.consecutiveFailures": 0,
          "emailStats.failureRate": failureRate,
          "emailStats.status": status,
        },
      },
    );
  }

  /**
   * Call this after every failed send
   */
  async recordFailure(clientCode: string, reason: string): Promise<void> {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) return;

    const totalSent = secrets.emailStats?.totalSent || 0;
    const totalFailed = (secrets.emailStats?.totalFailed || 0) + 1;
    const consecutiveFailures =
      (secrets.emailStats?.consecutiveFailures || 0) + 1;
    const failureRate = (totalFailed / (totalSent + totalFailed)) * 100;

    let status: "healthy" | "degraded" | "failing" | "unconfigured" = "healthy";
    if (consecutiveFailures >= 5 || failureRate > 20) {
      status = "failing";
    } else if (consecutiveFailures >= 3 || failureRate > 5) {
      status = "degraded";
    }

    await ClientSecrets.findOneAndUpdate(
      { clientCode },
      {
        $set: {
          "emailStats.totalFailed": totalFailed,
          "emailStats.lastFailedAt": new Date(),
          "emailStats.lastFailureReason": reason,
          "emailStats.consecutiveFailures": consecutiveFailures,
          "emailStats.failureRate": failureRate,
          "emailStats.status": status,
        },
      },
    );
  }

  /**
   * Get health summary for UI
   */
  async getHealthSummary(clientCode: string) {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error(`Client ${clientCode} not found`);

    let provider = (secrets.emailProvider ||
      "ses") as keyof typeof PROVIDER_CONFIG;
    if (!PROVIDER_CONFIG[provider]) {
      provider = "ses";
    }
    const config = PROVIDER_CONFIG[provider];
    const stats = secrets.emailStats || {
      totalSent: 0,
      totalFailed: 0,
      consecutiveFailures: 0,
      failureRate: 0,
      status: "unconfigured",
    };

    const recommendations: string[] = [];
    if (stats.failureRate > 20 && provider !== "ses") {
      recommendations.push(
        "Your failure rate is above 20%. Switch to Amazon SES.",
      );
    }
    if (stats.consecutiveFailures >= 3) {
      recommendations.push(
        `${stats.consecutiveFailures} consecutive failures. Check your email config.`,
      );
    }
    if (provider === "smtp" || provider === "zoho_smtp") {
      recommendations.push(
        "SMTP ports are often blocked. Amazon SES is recommended.",
      );
    }
    if (stats.status === "unconfigured") {
      recommendations.push(
        "Email not configured. Set up a provider to start sending.",
      );
    }
    if (provider === "ses") {
      const dnsRecords = secrets.sesDnsRecords || [];

      if (!secrets.sesDomain) {
        recommendations.push("Step 1: Enter your domain to start email setup.");
      } else if (!secrets.sesVerified) {
        recommendations.push(
          "Step 2: Add the 4 DNS records to your domain then click Check Verification.",
        );
      } else if (!secrets.getDecrypted("sesFromEmail")) {
        recommendations.push(
          "Step 3: Configure your from email address to activate sending.",
        );
      }
    }

    return {
      provider,
      providerLabel: config.label,
      providerRiskLevel: config.riskLevel,
      warningMessage: config.warningMessage,
      ...stats,
      recommendations,
    };
  }

  /**
   * Reset stats
   */
  async resetStats(clientCode: string): Promise<void> {
    await ClientSecrets.findOneAndUpdate(
      { clientCode },
      {
        $set: {
          emailStats: {
            totalSent: 0,
            totalFailed: 0,
            consecutiveFailures: 0,
            failureRate: 0,
            status: "unconfigured",
          },
        },
      },
    );
  }
}

export const emailHealthService = new EmailHealthService();
