import { Client } from "@models/clients/client";
import { StorageService } from "@services/StorageService";
import { JobHandler } from "../base.handler";

export class StorageProvisionJobHandler extends JobHandler {
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
