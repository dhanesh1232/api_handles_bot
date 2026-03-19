import { storageQuota } from "@middleware/storageQuota";
import { StorageService } from "@services/StorageService";
import { Router } from "express";

export const createStorageRouter = (io: any) => {
  const router = Router();

  /**
   * GET /api/saas/storage/usage
   * Returns current usage, quota, and folder stats.
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
   * POST /api/saas/storage/upload-url
   * Get a presigned URL for direct R2 upload.
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
