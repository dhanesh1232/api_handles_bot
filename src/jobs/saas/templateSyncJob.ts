import { dbConnect } from "../../lib/config.ts";
import { getTenantConnection } from "../../lib/connectionManager.ts";
import { ClientSecrets } from "../../model/clients/secrets.ts";
import { syncTemplatesFromMeta } from "../../services/saas/whatsapp/template.service.ts";

export const templateSyncJob = async () => {
  console.log("🚀 Starting Daily Template Sync Job...");
  await dbConnect("services");

  // Get all clients with WhatsApp credentials
  const clients = await ClientSecrets.find({
    isActive: true,
    "secrets.whatsappToken": { $exists: true },
    "secrets.whatsappBusinessId": { $exists: true },
  });

  console.log(`Found ${clients.length} clients to sync.`);

  for (const client of clients) {
    try {
      const clientCode = client.clientCode;
      const token = client.getDecrypted("whatsappToken");
      const businessId = client.getDecrypted("whatsappBusinessId");

      if (!token || !businessId) {
        console.warn(
          `[${clientCode}] Missing WhatsApp credentials, skipping sync.`,
        );
        continue;
      }

      console.log(`[${clientCode}] Syncing templates...`);
      const tenantConn = await getTenantConnection(clientCode);
      const result = await syncTemplatesFromMeta(tenantConn, token, businessId);

      console.log(
        `[${clientCode}] Sync completed: ${result.synced} templates. ${result.outdated.length} outdated.`,
      );

      if (result.outdated.length > 0) {
        console.warn(
          `[${clientCode}] The following templates need mapping update: ${result.outdated.join(", ")}`,
        );
        // TODO: Send alert/notification to tenant admin if required
      }
    } catch (error: any) {
      console.error(
        `❌ [${client.clientCode}] Template sync failed:`,
        error.message,
      );
    }
  }

  console.log("✅ Daily Template Sync Job Finished.");
};
