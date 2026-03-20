import { StorageService } from "@services/StorageService";
import { optimizeAndUploadMedia } from "@services/saas/media/media.service";
import { StorageClient } from "@/lib/storage/r2.client";
import { BaseSDK } from "./base.sdk";

/**
 * @file storage.sdk.ts
 * @module StorageSDK
 * @responsibility Unified facade for Cloudflare R2 file operations, media optimization, and tenant quota management.
 * @dependencies StorageService, media.service.ts, r2.client.ts
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
   * Uploads a file buffer with automatic tenant isolation and optional media optimization.
   *
   * **WORKING PROCESS:**
   * 1. Generates a unique `mediaId` and determines the tenant-specific S3/R2 prefix.
   * 2. Delegates to `optimizeAndUploadMedia`:
   *    - If `optimize` is true and it's an image/video, performs resizing/compression.
   *    - Uploads the resulting buffer(s) to R2.
   * 3. Calls `recordInternalAction` to update the tenant's database storage usage stats.
   * 4. Emits `storage:uploaded` for real-time UI/background consistency.
   *
   * @param {Buffer} buffer - File data.
   * @param {string} mimeType - e.g., 'image/jpeg', 'application/pdf'.
   * @param {string} [originalName] - Metadata for the original filename.
   * @param {string} [folder="general"] - Virtual folder within the tenant's bucket.
   * @param {object} [opts={optimize: true}] - Optimization controls.
   * @returns {Promise<OptimizedMediaResult>}
   * @edge_case Deducts usage even if cleanup fails, ensuring the tenant quota remains accurate.
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
   * Lists all files within a specific tenant folder by querying R2.
   *
   * @param {string} [folder="general"] - Target virtual folder.
   * @returns {Promise<any[]>}
   */
  async list(folder: string = "general") {
    // List directly from R2 via service for consistent prefixing / filtering
    const result = await this.service.listFiles(folder);
    return result.files;
  }

  /**
   * Permanently removes a file from R2 and restores storage quota.
   *
   * **WORKING PROCESS:**
   * 1. Invokes the `StorageService` to delete the object from the physical bucket.
   * 2. Decrements the `totalUsed` record in `ClientStorage`.
   * 3. Emits `storage:deleted` for cache invalidation.
   *
   * @param {string} key - The full R2 path key.
   * @returns {Promise<void>}
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
   * Generates a temporary URL for browser-side uploads (S3 Multipart compatible).
   *
   * @param {string} folder - Destination folder.
   * @param {string} filename - Target filename.
   * @param {string} contentType - e.g., 'video/mp4'.
   * @returns {Promise<{ url: string; key: string }>}
   */
  async getSignedUploadUrl(
    folder: string,
    filename: string,
    contentType: string,
  ) {
    return this.service.getUploadUrl(folder, filename, contentType);
  }

  /**
   * Generates a signed read URL with short TTL for private assets.
   *
   * @param {string} key - R2 path key.
   * @returns {Promise<string>}
   */
  async getSignedDownloadUrl(key: string) {
    return this.service.getDownloadUrl(key);
  }

  /**
   * Synchronizes the tenant's database usage records with the actual files in R2.
   *
   * **WORKING PROCESS:**
   * 1. Lists all objects in the tenant's R2 prefix.
   * 2. Sums the total bytes.
   * 3. Updates the `totalUsed` field in the `ClientStorage` document to ensure data consistency.
   *
   * @returns {Promise<{ totalSizeBytes: number }>}
   */
  async syncUsage() {
    return this.service.syncUsage();
  }

  /**
   * Retrieves current storage metrics and plan limits.
   *
   * @returns {Promise<{ used: number; limit: number; percentage: number }>}
   */
  async getUsage() {
    return this.service.getUsage();
  }

  // ─── Specialized Helpers ──────────────────────────────────────────────────

  /**
   * WhatsApp: Uploads media specifically to the 'whatsapp' sandbox.
   *
   * @param {Buffer} buffer - File data.
   * @param {string} mimeType - e.g., 'image/png'.
   * @param {string} [originalName] - Filename.
   * @returns {Promise<OptimizedMediaResult>}
   */
  async uploadWhatsAppMedia(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "whatsapp");
  }

  /**
   * CRM: Uploads document attachments for lead records.
   *
   * @param {Buffer} buffer - File data.
   * @param {string} mimeType - e.g., 'application/pdf'.
   * @param {string} [originalName] - Filename.
   * @returns {Promise<OptimizedMediaResult>}
   */
  async uploadLeadAttachment(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "crm");
  }

  /**
   * Profiles: Uploads and optimizes user avatar images.
   *
   * @param {Buffer} buffer - File data.
   * @param {string} mimeType - e.g., 'image/jpeg'.
   * @param {string} [originalName] - Filename.
   * @returns {Promise<OptimizedMediaResult>}
   */
  async uploadProfileImage(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "profile");
  }

  /**
   * Website: Uploads assets for CMS-managed public pages.
   *
   * @param {Buffer} buffer - File data.
   * @param {string} mimeType - e.g., 'image/webp'.
   * @param {string} [originalName] - Filename.
   * @returns {Promise<OptimizedMediaResult>}
   */
  async uploadWebsiteAsset(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ) {
    return this.upload(buffer, mimeType, originalName, "website");
  }
}
