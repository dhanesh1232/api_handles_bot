import express from "express";
import { validateClientKey } from "../../../middleware/saasAuth.js";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsappService.js";

export const createTemplateRouter = (io) => {
  const router = express.Router();
  const whatsappService = createWhatsappService(io);

  // POST /sync - Sync templates from Meta
  router.post("/sync", validateClientKey, async (req, res) => {
    try {
      const { clientCode } = req;
      const result = await whatsappService.syncTemplates(clientCode);
      res.json(result);
    } catch (error) {
      console.error("Sync error:", error);
      res.status(500).json({ error: "Failed to sync templates" });
    }
  });

  // GET / - Read templates from Local DB
  router.get("/", validateClientKey, async (req, res) => {
    try {
      const { clientCode } = req;
      const templates = await whatsappService.getTemplates(clientCode);
      res.json({ data: templates });
    } catch (error) {
      console.error("Fetch templates error:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  return router;
};
