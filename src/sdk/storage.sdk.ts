import { dbConnect } from "@lib/config";
import { ClientSecrets } from "@models/clients/secrets";
import {
  deleteObjectFromR2,
  listObjectsFromR2,
  optimizeAndUploadMedia,
} from "@services/saas/media/media.service";
import { BaseSDK } from "./base.sdk";

export class StorageSDK extends BaseSDK {
  /**
   * Internal helper to get client secrets.
   */
  private async getSecrets() {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({
      clientCode: this.clientCode.toUpperCase(),
    });
    if (!secrets)
      throw new Error(`Secrets not found for client: ${this.clientCode}`);
    return secrets;
  }

  /**
   * Upload and optimize media.
   */
  async upload(
    fileBuffer: Buffer,
    mimeType: string,
    originalFileName?: string,
    folder: string = "general",
  ) {
    const secrets = await this.getSecrets();
    return optimizeAndUploadMedia(
      fileBuffer,
      mimeType,
      originalFileName,
      `file_${Date.now()}`,
      secrets,
      folder,
    );
  }

  /**
   * List files in a folder.
   */
  async list(folder: string = "general") {
    const secrets = await this.getSecrets();
    return listObjectsFromR2(folder, secrets);
  }

  /**
   * Delete a file by key.
   */
  async delete(key: string) {
    const secrets = await this.getSecrets();
    return deleteObjectFromR2(key, secrets);
  }
}
