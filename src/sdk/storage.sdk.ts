import { StorageService } from "@services/StorageService";
import {
  type OptimizedMediaResult,
  optimizeAndUploadMedia,
} from "@services/saas/media/media.service";
import { StorageClient } from "@/lib/storage/r2.client";
import { BaseSDK } from "./base.sdk";

/**
 * StorageSDK - Unified Cloudflare R2 Interface
 *
 * Handles all file operations: general documents, optimized media,
 * presigned URLs, and tenant prefix isolation.
 * Automatically synchronizes usage stats with ClientStorage.
 */
export class StorageSDK extends BaseSDK {
  private _service: StorageService | null = null;

  /**
   * Internal lazy service getter
   */
  private get service() {
    if (!this._service) {
      this._service = new StorageService(this.clientCode);
    }
    return this._service;
  }

  /**
   * Internal helper to retrieve storage client and determined prefix.
   */
  private async getStorageContext() {
    return {
      storage: StorageClient.fromUniversal(),
      prefix: `tenants/${this.clientCode.toUpperCase()}/`,
    };
  }

  /**
   * Core: Upload a file. Automatically handles media optimization unless disabled.
   * Records usage in ClientStorage.
   */
  async upload(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
    folder: string = "general",
    _options: { optimize?: boolean } = { optimize: true },
  ): Promise<OptimizedMediaResult> {
    const { storage, prefix } = await this.getStorageContext();
    const mediaId = `file_${Date.now()}`;

    // 1. Process and Upload to R2
    const result = await optimizeAndUploadMedia(
      buffer,
      mimeType,
      originalName,
      mediaId,
      storage,
      `${prefix}${folder}`,
    );

    // 2. Record Usage in Database
    await this.service.recordInternalAction(
      "upload",
      result.key,
      result.size,
      "user",
    );

    // 3. Emit real-time event
    this.emit("storage:uploaded", {
      folder,
      fileName: result.fileName,
      url: result.url,
      size: result.size,
      clientCode: this.clientCode,
    });

    return result;
  }

  /**
   * Core: List files in a folder.
   */
  async list(folder: string = "general") {
    // List directly from R2 via service for consistent prefixing / filtering
    const result = await this.service.listFiles(folder);
    return result.files;
  }

  /**
   * Core: Delete a file by its R2 key.
   * Automatically decrements usage in ClientStorage.
   */
  async delete(key: string): Promise<void> {
    // Delegate to service to handle both R2 deletion and DB usage decrement
    await this.service.deleteFile(key);

    this.emit("storage:deleted", {
      key,
      clientCode: this.clientCode,
    });
  }

  /**
   * Presigned: Get an upload URL for large files or browser-direct uploads.
   */
  async getSignedUploadUrl(
    folder: string,
    filename: string,
    contentType: string,
  ) {
    return this.service.getUploadUrl(folder, filename, contentType);
  }

  /**
   * Presigned: Get a download URL.
   */
  async getSignedDownloadUrl(key: string) {
    return this.service.getDownloadUrl(key);
  }

  /**
   * Utility: Sync usage from R2 to Database for this client.
   */
  async syncUsage() {
    return this.service.syncUsage();
  }

  /**
   * Utility: Get current usage and quota information.
   */
  async getUsage() {
    return this.service.getUsage();
  }

  // ─── Specialized Helpers ──────────────────────────────────────────────────

  /**
   * WhatsApp: Upload media with 'whatsapp' folder prefix.
   */
  async uploadWhatsAppMedia(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "whatsapp");
  }

  /**
   * CRM: Upload lead attachments.
   */
  async uploadLeadAttachment(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "crm");
  }

  /**
   * Profiles: Upload user or client profile images.
   */
  async uploadProfileImage(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "profile");
  }

  /**
   * Website: Upload assets for landing pages or blogs.
   */
  async uploadWebsiteAsset(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "website");
  }
}
