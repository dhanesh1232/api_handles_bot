import { dbConnect } from "@lib/config";
import { jobLogger } from "@lib/logger";
import { getCrmModels } from "@lib/tenant/get.crm.model";
import { ClientSecrets } from "@models/clients/secrets";
import { syncTemplatesFromMeta } from "@services/saas/whatsapp/template.service";

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
