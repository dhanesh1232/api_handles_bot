import { Client } from "@models/clients/client";
import { StorageService } from "@services/StorageService";
import { JobHandler } from "../base.handler";

export class StorageProvisionJobHandler extends JobHandler {
  /**
   * Initializes the storage environment (R2/S3) for a new tenant.
   *
   * @param clientCode - Tenant identifier.
   *
   * **DETAILED EXECUTION:**
   * 1. **Client Verification**: Confirms the tenant exists in the global `Client` registry.
   * 2. **Folder Bootstrapping**: Initializes the `StorageService` for the tenant and creates mandatory system folders (e.g., `/leads`, `/templates`, `/exports`).
   * 3. **Permissions**: Ensures the tenant-specific bucket prefix is ready for public/private asset hosting.
   */
  async handle(clientCode: string, _payload: any): Promise<void> {
    this.log.info({ clientCode }, "Provisioning storage for client");

    const client = await Client.findOne({ clientCode });
    if (!client) {
      throw new Error(`Client not found: ${clientCode}`);
    }

    const storageService = new StorageService(clientCode);
    await storageService.seedDefaultFolders();

    this.log.info({ clientCode }, "Storage provisioned successfully");
  }
}
