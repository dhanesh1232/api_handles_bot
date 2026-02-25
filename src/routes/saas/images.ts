import express, { type Response } from "express";
import multer from "multer";
import { dbConnect } from "../../lib/config.ts";
import {
  validateClientKey,
  type AuthRequest,
} from "../../middleware/saasAuth.ts";
import { ClientSecrets } from "../../model/clients/secrets.ts";
import {
  listObjectsFromR2,
  optimizeAndUploadMedia,
} from "../../services/saas/media/media.service.ts";

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
    async (req: AuthRequest, res: Response) => {
      try {
        const { clientCode } = req;
        const folder = (req.query.folder as string) || "profile";

        if (!clientCode) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        await dbConnect("services");
        const secrets = await ClientSecrets.findOne({ clientCode });

        if (!secrets) {
          return res.status(404).json({ error: "Client secrets not found" });
        }

        const images = await listObjectsFromR2(folder, secrets);

        res.status(200).json({
          message: "Images fetched successfully",
          data: { images },
        });
      } catch (error: any) {
        console.error("List images error:", error.message);
        res.status(500).json({ error: "Failed to fetch images" });
      }
    },
  );

  // POST /api/images - Upload image for the client
  router.post(
    "/",
    validateClientKey,
    upload.single("file"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { clientCode } = req;
        if (!clientCode) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const folder = req.body.folder || "profile";

        await dbConnect("services");
        const secrets = await ClientSecrets.findOne({ clientCode });

        if (!secrets) {
          return res.status(404).json({ error: "Client secrets not found" });
        }

        const result = await optimizeAndUploadMedia(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          `img_${Date.now()}`,
          secrets,
          folder,
        );

        res.status(201).json({
          message: "Image uploaded successfully",
          data: {
            url: result.url,
            name: result.fileName,
            fileName: result.fileName,
            key: result.r2Key,
          },
        });
      } catch (error: any) {
        console.error("Upload error:", error.message);
        res.status(500).json({ error: "Upload failed: " + error.message });
      }
    },
  );

  return router;
};
