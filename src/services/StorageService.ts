import { logger } from "@lib/logger";
import { ClientStorage } from "@models/clients/ClientStorage";
import { StorageEvent } from "@models/clients/StorageEvent";
import { StorageClient } from "@/lib/storage/r2.client";
import {
  DEFAULT_SYSTEM_FOLDERS,
  R2_PRESIGN_EXPIRY,
} from "../constants/storage";

export class StorageService {
  private readonly tenantPrefix: string;
  private readonly storage: StorageClient;

  constructor(private readonly clientCode: string) {
    this.tenantPrefix = `tenants/${clientCode}`;
    this.storage = StorageClient.fromUniversal();
  }

  /**
   * Private: Build key with tenant isolation and optional date sharding.
   */
  private buildKey(
    folder: string,
    filename: string,
    dateShard?: boolean,
  ): string {
    let key: string;
    if (dateShard) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      key = `${this.tenantPrefix}/${folder}/${year}/${month}/${filename}`;
    } else {
      key = `${this.tenantPrefix}/${folder}/${filename}`;
    }

    this.assertKeyScope(key);
    return key;
  }

  /**
   * Private: Security guard to ensure key is within tenant scope.
   */
  private assertKeyScope(key: string): void {
    if (!key.startsWith(this.tenantPrefix)) {
      throw new Error(
        `[StorageService] Key scope violation blocked. Key: ${key}`,
      );
    }
  }

  /**
   * Public: Generate a signed URL for direct upload to R2.
   */
  async getUploadUrl(
    folderName: string,
    filename: string,
    _contentType: string,
    expiresIn: number = R2_PRESIGN_EXPIRY.upload,
  ) {
    const storage = await ClientStorage.findOne({
      clientCode: this.clientCode,
    });
    if (!storage) throw new Error("Storage not provisioned for this client");

    if (storage.isSuspended || storage.isOverQuota()) {
      throw new Error("Storage suspended or quota exceeded");
    }

    const folder = storage.folders.find((f) => f.name === folderName);
    if (!folder) {
      throw new Error(`Folder '${folderName}' not found in client storage`);
    }

    const key = this.buildKey(folderName, filename, folder.dateShard);
    const uploadUrl = await this.storage.getSignedUrl(key, expiresIn);

    return {
      uploadUrl,
      key,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  /**
   * Public: Confirm upload after frontend direct upload.
   */
  async confirmUpload(key: string, sizeBytes: number) {
    return this.recordInternalAction("upload", key, sizeBytes, "user");
  }

  /**
   * Public: Record an internal storage action (SDK or System).
   */
  async recordInternalAction(
    action: "upload" | "delete",
    key: string,
    sizeBytes: number,
    triggeredBy: "user" | "system" = "user",
  ) {
    this.assertKeyScope(key);

    const parts = key.split("/");
    const folderName = parts[2] || "general";

    const increment = action === "upload" ? sizeBytes : -sizeBytes;
    const fileInc = action === "upload" ? 1 : -1;

    const storage = await ClientStorage.findOneAndUpdate(
      { clientCode: this.clientCode, "folders.name": folderName },
      {
        $inc: {
          usedBytes: increment,
          "folders.$.fileCount": fileInc,
          "folders.$.sizeBytes": increment,
        },
      },
      { new: true },
    );

    if (!storage) {
      // If folder not found, try updating root usedBytes at least
      await ClientStorage.findOneAndUpdate(
        { clientCode: this.clientCode },
        { $inc: { usedBytes: increment } },
      );
    }

    await StorageEvent.create({
      clientCode: this.clientCode,
      action,
      key,
      folder: folderName,
      sizeBytes,
      triggeredBy,
    });

    return { success: true };
  }

  /**
   * Public: Generate a signed URL for downloading a file.
   */
  async getDownloadUrl(
    key: string,
    expiresIn: number = R2_PRESIGN_EXPIRY.download,
  ) {
    this.assertKeyScope(key);

    const downloadUrl = await this.storage.getSignedUrl(key, expiresIn);

    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  /**
   * Public: List files in a folder with optional date filtering.
   */
  async listFiles(folderName: string, year?: string, month?: string) {
    let prefix = `${this.tenantPrefix}/${folderName}/`;
    if (year && month) {
      prefix = `${this.tenantPrefix}/${folderName}/${year}/${month}/`;
    }

    const items = await this.storage.list(prefix);
    const files = await Promise.all(
      items
        .filter((item) => !item.key.endsWith(".keep"))
        .map(async (item) => ({
          url: await this.storage.getUrl(item.key),
          key: item.key,
          filename: item.key.split("/").pop() || "",
          sizeBytes: item.size,
          lastModified: item.lastModified,
          folder: folderName,
        })),
    );

    return {
      files,
      count: files.length,
      totalSizeBytes: files.reduce((acc, f) => acc + f.sizeBytes, 0),
    };
  }

  /**
   * Public: Delete a file by key.
   */
  async deleteFile(key: string) {
    this.assertKeyScope(key);

    if (key.endsWith(".keep")) {
      throw new Error("Cannot delete system placeholder files");
    }

    const parts = key.split("/");
    const folderName = parts[2];

    // Get size before delete
    let sizeBytes = 0;
    try {
      const items = await this.storage.list(key); // Prefix = key
      const match = items.find((i) => i.key === key);
      sizeBytes = match?.size || 0;
    } catch (err: any) {
      logger.warn(
        { err: err.message, key },
        "Metadata check failed during delete, assuming 0 bytes",
      );
    }

    await this.storage.delete(key);

    await ClientStorage.findOneAndUpdate(
      { clientCode: this.clientCode, "folders.name": folderName },
      {
        $inc: {
          usedBytes: -sizeBytes,
          "folders.$.fileCount": -1,
          "folders.$.sizeBytes": -sizeBytes,
        },
      },
    );

    await StorageEvent.create({
      clientCode: this.clientCode,
      action: "delete",
      key,
      folder: folderName,
      sizeBytes,
      triggeredBy: "user",
    });

    return { deleted: true };
  }

  /**
   * Public: Create a new folder for a client.
   */
  async createFolder(name: string) {
    if (!/^[a-z0-9-]+$/.test(name) || name.length > 40) {
      throw new Error(
        "Invalid folder name. Use lowercase, numbers, and hyphens only (max 40 chars).",
      );
    }

    const storage = await ClientStorage.findOne({
      clientCode: this.clientCode,
    });
    if (!storage) throw new Error("Client storage not provisioned");

    if (storage.folders.some((f) => f.name === name)) {
      throw new Error(`Folder '${name}' already exists`);
    }

    const key = this.buildKey(name, ".keep", false);
    await this.storage.upload(key, Buffer.from(""), "application/x-directory");

    const newFolder = {
      name,
      prefix: `${this.tenantPrefix}/${name}/`,
      isSystem: false,
      dateShard: false,
      fileCount: 0,
      sizeBytes: 0,
      createdAt: new Date(),
    };

    await ClientStorage.findOneAndUpdate(
      { clientCode: this.clientCode },
      { $push: { folders: newFolder } },
    );

    await StorageEvent.create({
      clientCode: this.clientCode,
      action: "folder_create",
      folder: name,
      triggeredBy: "user",
    });

    return newFolder;
  }

  /**
   * Public: Seed default folders for a new client.
   */
  async seedDefaultFolders() {
    const folders = [];
    for (const folderDef of DEFAULT_SYSTEM_FOLDERS) {
      const key = this.buildKey(folderDef.name, ".keep", false);
      await this.storage.upload(
        key,
        Buffer.from(""),
        "application/x-directory",
      );

      const folder = {
        name: folderDef.name,
        prefix: `${this.tenantPrefix}/${folderDef.name}/`,
        isSystem: true,
        dateShard: folderDef.dateShard,
        fileCount: 0,
        sizeBytes: 0,
        createdAt: new Date(),
      };
      folders.push(folder);

      await StorageEvent.create({
        clientCode: this.clientCode,
        action: "folder_create",
        folder: folderDef.name,
        triggeredBy: "system",
      });
    }

    await ClientStorage.findOneAndUpdate(
      { clientCode: this.clientCode },
      { $set: { folders } },
    );
  }

  /**
   * Public: Full R2 -> MongoDB reconciliation.
   */
  async syncUsage() {
    let totalUsedBytes = 0;
    let totalFileCount = 0;
    const folderStats: Record<string, { size: number; count: number }> = {};

    const items = await this.storage.list(`${this.tenantPrefix}/`);

    for (const item of items) {
      totalUsedBytes += item.size;
      totalFileCount += 1;

      // tenants/{clientId}/{folder}/...
      const parts = item.key.split("/");
      const folderName = parts[2];
      if (folderName) {
        if (!folderStats[folderName]) {
          folderStats[folderName] = { size: 0, count: 0 };
        }
        folderStats[folderName].size += item.size;
        folderStats[folderName].count += 1;
      }
    }

    const storage = await ClientStorage.findOne({
      clientCode: this.clientCode,
    });
    if (!storage) throw new Error("Client storage not found during sync");

    // Update folders
    for (const folder of storage.folders) {
      const stats = folderStats[folder.name] || { size: 0, count: 0 };
      folder.sizeBytes = stats.size;
      folder.fileCount = stats.count;
    }

    storage.usedBytes = totalUsedBytes;
    storage.lastSyncedAt = new Date();
    await storage.save();

    await StorageEvent.create({
      clientCode: this.clientCode,
      action: "sync",
      triggeredBy: "cron",
      meta: { usedBytes: totalUsedBytes, fileCount: totalFileCount },
    });

    return {
      usedBytes: totalUsedBytes,
      usagePercent: storage.usagePercent,
    };
  }

  /**
   * Public: Get usage details (cached in MongoDB).
   */
  async getUsage() {
    const storage = await ClientStorage.findOne({
      clientCode: this.clientCode,
    });
    if (!storage) throw new Error("Client storage not provisioned");

    return {
      usedBytes: storage.usedBytes,
      quotaBytes: storage.quotaBytes,
      usagePercent: storage.usagePercent,
      lastSyncedAt: storage.lastSyncedAt,
      isSuspended: storage.isSuspended,
      folders: storage.folders,
    };
  }
}
