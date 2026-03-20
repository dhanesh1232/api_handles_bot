import { PROVIDER_CONFIG } from "@/config/emailProviders";
import { ClientSecrets } from "@/model/clients/secrets";

class EmailHealthService {
  /**
   * Updates delivery metrics and health status after a successful email dispatch.
   *
   * **WORKING PROCESS:**
   * 1. Persistence: Recalculates the global `failureRate` using the updated `totalSent` counter.
   * 2. Heuristic Check: Resets `consecutiveFailures` to zero.
   * 3. State Transition: Re-evaluates health status (healthy/degraded/failing). If failure rate is <5%, remains `healthy`.
   *
   * @param {string} clientCode - Tenant identifier.
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
   * Records a failed delivery attempt and potentially degrades/suspends the provider status.
   *
   * **WORKING PROCESS:**
   * 1. Persistence: Logs the specific error reason and increments `consecutiveFailures`.
   * 2. Risk Evaluation:
   *    - **Degraded**: Triggered after 3 consecutive failures or >5% failure rate.
   *    - **Failing**: Triggered after 5 consecutive failures or >20% failure rate.
   * 3. Sync: Updates the `ClientSecrets` document to alert the UI and downstream consumers.
   *
   * **EDGE CASES:**
   * - Cascading Failure: Successive failures will quickly move a tenant to "failing" to prevent further reputation damage.
   *
   * @param {string} clientCode - Tenant identifier.
   * @param {string} reason - Error message from the provider.
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
   * Aggregates stats and health-check logic into human-readable recommendations.
   *
   * **WORKING PROCESS:**
   * 1. Data Merging: Combines raw stats with provider-specific risk metadata (from `PROVIDER_CONFIG`).
   * 2. Diagnostic Rules:
   *    - High Failure Rate (>20%): Recommends switching to Amazon SES.
   *    - SMTP usage: Flags potential port blocking issues.
   *    - Unconfigured SES: Dynamic checklist for domain -> DNS -> from email onboarding steps.
   *
   * @param {string} clientCode - Tenant identifier.
   * @returns {Promise<object>} Stats, status, and a prioritized list of `recommendations`.
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
