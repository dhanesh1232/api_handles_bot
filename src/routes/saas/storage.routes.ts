import { storageQuota } from "@middleware/storageQuota";
import { StorageService } from "@services/StorageService";
import { Router } from "express";

/**
 * Factory for tenant-scoped Cloud Storage orchestration.
 *
 * **GOAL:** Manage unstructured data (files, images, documents) using a "Private Cloud" model where each tenant has a logical partition in R2/S3.
 *
 * **DETAILED EXECUTION:**
 * 1. **Security Guarding**: Mounts the `storageQuota` middleware on all write operations to prevent unbilled storage consumption.
 * 2. **Presigned Flows**: Implements a high-security upload flow where the backend generates a short-lived URL, allowing the browser to upload directly to object storage without stressing the Node.js process.
 * 3. **Usage Accounting**: Dynamically calculates per-tenant storage metrics via the `StorageService`.
 *
 * @param _io - Socket.io instance (placeholder for future real-time upload progress).
 * @returns {Router} An Express router pre-configured with storage endpoints.
 */
export const createStorageRouter = (_io: any) => {
  const router = Router();
  /**
   * Tenant Storage Metrics.
   *
   * **GOAL:** Compute and return the total bytes consumed by a tenant across all folders (profile, chat, documents).
   *
   * **DETAILED EXECUTION:**
   * 1. **Service Instantiation**: Spawns a `StorageService` anchored to the current `clientCode`.
   * 2. **Bucket Introspection**: Iterates through R2 metadata to sum object sizes.
   */
  router.get("/usage", async (req: any, res) => {
    try {
      const { clientCode } = req;
      const service = new StorageService(clientCode);
      const usage = await service.getUsage();
      res.json({ message: "Storage usage retrieved", data: usage });
    } catch (err: any) {
      req.log.error({ err: err.message }, "GET /usage failed");
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/saas/storage/folders
   * Create a new folder.
   */
  router.post("/folders", storageQuota, async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { name } = req.body;
      if (!name)
        return res.status(400).json({ error: "Folder name is required" });

      const service = new StorageService(clientCode);
      const folder = await service.createFolder(name);
      res.json({ message: "Folder created", data: folder });
    } catch (err: any) {
      req.log.error(
        { err: err.message, body: req.body },
        "POST /folders failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Direct Upload Presigning.
   *
   * **GOAL:** Generate a high-security, short-lived PUT URL that allows a client to upload directly to R2, bypassing the Node.js server to conserve CPU and Memory.
   *
   * **DETAILED EXECUTION:**
   * 1. **Quota Verification**: The `storageQuota` middleware first checks if the tenant has remaining space before allowing the presign.
   * 2. **Signed Token Generation**: Uses AWS-V4 signing logic to create a URL scoped to a specific `key` and `contentType`.
   */
  router.post("/upload-url", storageQuota, async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { folder, filename, contentType } = req.body;

      if (!folder || !filename || !contentType) {
        return res.status(400).json({
          error: "Missing required fields: folder, filename, contentType",
        });
      }

      const service = new StorageService(clientCode);
      const data = await service.getUploadUrl(folder, filename, contentType);
      res.json({ message: "Upload URL generated", data });
    } catch (err: any) {
      req.log.error(
        { err: err.message, body: req.body },
        "POST /upload-url failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/saas/storage/confirm-upload
   * Notify backend after a successful direct browser upload.
   */
  router.post("/confirm-upload", async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { key, sizeBytes } = req.body;

      if (!key || sizeBytes === undefined) {
        return res
          .status(400)
          .json({ error: "Missing required fields: key, sizeBytes" });
      }

      const service = new StorageService(clientCode);
      const data = await service.confirmUpload(key, sizeBytes);
      res.json({ message: "Upload confirmed", data });
    } catch (err: any) {
      req.log.error(
        { err: err.message, body: req.body },
        "POST /confirm-upload failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/saas/storage/files/:folder
   * List files in a folder.
   */
  router.get("/files/:folder", async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { folder } = req.params;
      const { year, month } = req.query;

      const service = new StorageService(clientCode);
      const data = await service.listFiles(
        folder,
        year as string,
        month as string,
      );
      res.json({ message: "Files retrieved", data });
    } catch (err: any) {
      req.log.error(
        { err: err.message, params: req.params },
        "GET /files/:folder failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/saas/storage/download-url
   * Get a presigned download URL for an R2 key.
   */
  router.post("/download-url", async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { key } = req.body;

      if (!key) return res.status(400).json({ error: "Key is required" });

      const service = new StorageService(clientCode);
      const data = await service.getDownloadUrl(key);
      res.json({ message: "Download URL generated", data });
    } catch (err: any) {
      req.log.error(
        { err: err.message, body: req.body },
        "POST /download-url failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/saas/storage/files
   * Delete a file by key.
   */
  router.delete("/files", async (req: any, res) => {
    try {
      const { clientCode } = req;
      const { key } = req.query;

      if (!key) return res.status(400).json({ error: "Key is required" });

      const service = new StorageService(clientCode);
      const data = await service.deleteFile(key as string);
      res.json({ message: "File deleted", data });
    } catch (err: any) {
      req.log.error(
        { err: err.message, query: req.query },
        "DELETE /files failed",
      );
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
