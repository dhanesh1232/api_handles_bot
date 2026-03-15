import express, { type Response } from "express";
import multer from "multer";
import { type AuthRequest, validateClientKey } from "@/middleware/saasAuth";
import { withSDK } from "@/middleware/withSDK";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

export const createImagesRouter = (_io: any) => {
  const router = express.Router();

  // GET /api/images - List images for the client
  router.get(
    "/",
    validateClientKey,
    withSDK(),
    async (req: AuthRequest, res: Response) => {
      try {
        const folder = (req.query.folder as string) || "profile";
        const images = await req.sdk.storage.list(folder);

        res.status(200).json({
          message: "Images fetched successfully",
          data: { images },
        });
      } catch (error: any) {
        req.log.error({ err: error.message }, "List images error");
        res.status(500).json({ error: "Failed to fetch images" });
      }
    },
  );

  // POST /api/images - Upload image for the client
  router.post(
    "/",
    validateClientKey,
    withSDK(),
    upload.single("file"),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const folder = req.body.folder || "profile";

        const result = await req.sdk.storage.upload(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          folder,
        );

        res.status(201).json({
          message: "Image uploaded successfully",
          data: {
            url: result.url,
            name: result.fileName,
            fileName: result.fileName,
            key: result.key,
            type: result.key.split(".").pop(),
          },
        });
      } catch (error: any) {
        req.log.error({ err: error.message }, "Upload error");
        res.status(500).json({ error: `Upload failed: ${error.message}` });
      }
    },
  );

  // DELETE /api/images - Delete image for the client
  router.delete(
    "/",
    validateClientKey,
    withSDK(),
    async (req: AuthRequest, res: Response) => {
      try {
        const key = req.query.key as string;

        if (!key) {
          return res.status(400).json({ error: "Media key is required" });
        }

        await req.sdk.storage.delete(key);

        res.status(200).json({
          message: "Media deleted successfully",
          data: { key },
        });
      } catch (error: any) {
        req.log.error({ err: error.message }, "Delete media error");
        res.status(500).json({ error: "Failed to delete media" });
      }
    },
  );

  return router;
};
