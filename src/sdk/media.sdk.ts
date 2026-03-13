import { BaseSDK } from "./base.sdk";
import {
  optimizeAndUploadMedia,
  listObjectsFromR2,
  deleteObjectFromR2,
  type OptimizedMediaResult,
} from "@services/saas/media/media.service";
import { ClientSecrets } from "@models/clients/secrets";
import { dbConnect } from "@lib/config";

/**
 * MediaSDK
 *
 * Specialized SDK for handling all media assets (images, videos, documents).
 * Extends BaseSDK to inherit clientCode and Socket.io context.
 */
export class MediaSDK extends BaseSDK {
  /**
   * Internal helper to retrieve client secrets for R2 storage.
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
   * Upload and optimize an asset.
   * Automatically handles image resizing/compression and video transcoding.
   */
  async upload(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
    folder: "profile" | "crm" | "whatsapp" | "website" | "general" = "general",
  ): Promise<OptimizedMediaResult> {
    const secrets = await this.getSecrets();
    const mediaId = `media_${Date.now()}`;

    const result = await optimizeAndUploadMedia(
      buffer,
      mimeType,
      originalName,
      mediaId,
      secrets,
      folder,
    );

    // Emit real-time event if needed
    this.emit("media:uploaded", {
      folder,
      fileName: result.fileName,
      url: result.url,
    });

    return result;
  }

  /**
   * List all assets in a specific folder.
   */
  async list(folder: string = "general") {
    const secrets = await this.getSecrets();
    return listObjectsFromR2(folder, secrets);
  }

  /**
   * Delete an asset by its R2 key.
   */
  async delete(key: string): Promise<void> {
    const secrets = await this.getSecrets();
    await deleteObjectFromR2(key, secrets);
    this.emit("media:deleted", { key });
  }

  /**
   * Helper for WhatsApp specifically (ensures 'whatsapp' folder).
   */
  async uploadWhatsAppMedia(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "whatsapp");
  }

  /**
   * Helper for CRM Lead attachments.
   */
  async uploadLeadAttachment(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "crm");
  }
}
