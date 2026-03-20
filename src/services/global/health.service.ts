import { dbConnect } from "@lib/config";
import { getCrmModels } from "@lib/tenant/crm.models";
import { Client } from "@models/clients/client";

/**
 * @module Services/Global/Health
 * @responsibility Proactive monitoring for agency portfolio health and operational readiness.
 *
 * **GOAL:** Detect "Silent Failures" (e.g., disconnected WhatsApp, missing CRM steps) across thousands of tenants simultaneously, allowing support teams to intervene before clients notice issues.
 */
export const HealthService = {
  /**
   * Run a health check on all clients under an agency or globally.
   * Provides a "Red/Yellow/Green" status report of critical infrastructure.
   *
   * @param agencyCode - (Optional) The identifier for an agency (e.g., "EDX_AGENCY"). If omitted, checks ALL clients in the system.
   *
   * @returns {Promise<Array<Object>>} A structured array of health reports. Each object contains `clientCode`, `name`, and an `issues` array.
   *
   * **DETAILED EXECUTION:**
   * 1. **Data Loading**: Fetches `Client` meta-records from the control-plane database.
   * 2. **WhatsApp Vital Check**:
   *    - Inspects the `whatsapp.status` field.
   *    - If `enabled` is true but status is `disconnected`, it injects a "whatsapp_disconnect" error.
   * 3. **Aggregation**: Collects only those clients who have 1 or more issues into the final response array.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Scale Failure: For massive agencies (1000+ clients), this loop is synchronous; future iterations should use worker queues.
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

      if (clientHealth.issues.length > 0) {
        report.push(clientHealth);
      }
    }

    return report;
  },

  /**
   * Evaluates if a client has initial CRM infrastructure (pipelines/stages) configured.
   *
   * @param clientCode - The tenant identifier.
   *
   * @returns {Promise<Object>} Readiness payload containing counts and a boolean `isReady`.
   *
   * @throws {Error} If `getCrmModels` cannot connect to the tenant database.
   *
   * **DETAILED EXECUTION:**
   * 1. **Infrastructure Query**: Reaches into the tenant's DB and counts three tables in parallel: `Pipeline`, `PipelineStage`, and `AutomationRule`.
   * 2. **Logic Mapping**:
   *    - `isReady` = `true` if (pipelines > 0 AND stages > 0).
   * 3. **AI Suggestion**: If pipelines are missing, it returns a prompt for the user to "Deploy a Blueprint".
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
