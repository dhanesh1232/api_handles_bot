import { dbConnect } from "@lib/config";
import { jobLogger } from "@lib/logger";
import { getCrmModels } from "@lib/tenant/crm.models";
import { ClientSecrets } from "@models/clients/secrets";
import { syncTemplatesFromMeta } from "@services/saas/whatsapp/template.service";

/**
 * @module Jobs/SaaS/TemplateSync
 * @responsibility Synchronizes Meta-approved WhatsApp templates with the local tenant database.
 *
 * **WHY THIS EXISTS:**
 * WhatsApp templates can be updated or deleted on the Meta Business Manager. This job ensures
 * the local cache is fresh, preventing "Template not found" errors during automation.
 *
 * **WORKING PROCESS:**
 * 1. Discovery: Connects to core DB and fetches all active clients with WhatsApp credentials.
 * 2. Decryption: Retrieves Meta Tokens and Business IDs from secure storage.
 * 3. Synchronization:
 *    - Fetches the current list of templates from Meta's API.
 *    - Updates the local registry (add new, update existing).
 *    - Flags "outdated" templates that require manual variable mapping.
 *
 * **EDGE CASES:**
 * - Credential Failure: If a token is expired, the client is skipped and an error is logged.
 * - Mapping Discrepancy: If Meta adds new variables, the job flags them for user intervention.
 */
export const templateSyncJob = async () => {
  const log = jobLogger("templateSync");
  log.info("Starting Daily Template Sync Job");
  await dbConnect("services");

  const clients = await ClientSecrets.find({
    isActive: true,
    "secrets.whatsappToken": { $exists: true },
    "secrets.whatsappBusinessId": { $exists: true },
  });

  log.info({ count: clients.length }, "Clients to sync");

  for (const client of clients) {
    const clientLog = log.child({ clientCode: client.clientCode });
    try {
      const clientCode = client.clientCode;
      const token = client.getDecrypted("whatsappToken");
      const businessId = client.getDecrypted("whatsappBusinessId");

      if (!token || !businessId) {
        clientLog.warn("Missing WhatsApp credentials, skipping");
        continue;
      }

      clientLog.info("Syncing templates");
      const { conn: tenantConn } = await getCrmModels(clientCode);
      const result = await syncTemplatesFromMeta(tenantConn, token, businessId);

      clientLog.info(
        { synced: result.synced, outdated: result.outdated.length },
        "Sync completed",
      );

      if (result.outdated.length > 0) {
        clientLog.warn(
          { templates: result.outdated.join(", ") },
          "Templates need mapping update",
        );
      }
    } catch (error: any) {
      clientLog.error({ err: error }, "Template sync failed");
    }
  }

  log.info("Daily Template Sync Job finished");
};
