import { dbConnect } from "@lib/config";
import { Client } from "@models/clients/client";
import { getCrmModels } from "@lib/tenant/crm.models";

/**
 * Health Sentinel Service
 * Proactive monitoring for agency portfolio health.
 */
export const HealthService = {
  /**
   * Run a health check on all clients under an agency or globally.
   * Returns a report of critical failures (status check).
   */
  checkPortfolioHealth: async (agencyCode?: string) => {
    await dbConnect("services");
    const query = agencyCode ? { agencyCode } : {};
    const clients = await Client.find(query).lean();

    const report = [];

    for (const client of clients) {
      const clientHealth: any = {
        clientCode: client.clientCode,
        name: client.name,
        issues: [],
      };

      // 1. Check WhatsApp Connectivity
      if (
        client.whatsapp?.enabled &&
        client.whatsapp.status === "disconnected"
      ) {
        clientHealth.issues.push({
          type: "whatsapp_disconnect",
          severity: "error",
          message: "WhatsApp instance is disconnected.",
        });
      }

      // 2. Check Credit Health (Logic from UsageService)
      // (This could be expanded to look up ClientUsage models)

      // 3. Check for stuck queues or old pending items (if possible)

      if (clientHealth.issues.length > 0) {
        report.push(clientHealth);
      }
    }

    return report;
  },

  /**
   * Check a single client's "operational readiness"
   */
  checkClientReadiness: async (clientCode: string) => {
    const { Pipeline, PipelineStage, AutomationRule } =
      await getCrmModels(clientCode);

    const [pipelines, stages, rules] = await Promise.all([
      Pipeline.countDocuments({ clientCode }),
      PipelineStage.countDocuments({ clientCode }),
      AutomationRule.countDocuments({ clientCode, isActive: true }),
    ]);

    return {
      clientCode,
      counts: { pipelines, stages, rules },
      isReady: pipelines > 0 && stages > 0,
      suggestion:
        pipelines === 0 ? "Deploy a CRM Blueprint to get started." : null,
    };
  },
};
