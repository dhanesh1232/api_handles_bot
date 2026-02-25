import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsapp.service.ts";

export interface SaasRequest extends Request {
  clientCode: string;
  user?: any;
}

export const createTemplateRouter = (io: Server) => {
  const router = express.Router();
  const whatsappService = createWhatsappService(io);

  // POST /sync - Sync templates from Meta
  router.post(
    "/sync",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const result = await whatsappService.syncTemplates(clientCode);
        res.json(result);
      } catch (error) {
        console.error("Sync error:", error);
        res.status(500).json({ error: "Failed to sync templates" });
      }
    },
  );

  // GET / - Read templates from Local DB
  router.get("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const sReq = req as SaasRequest;
      const clientCode = sReq.clientCode!;
      const channel = req.query.channel as string;
      const templates = await whatsappService.getTemplates(clientCode, channel);
      res.json({ data: templates });
    } catch (error) {
      console.error("Fetch templates error:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  // POST / - Create a new template manually
  router.post("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const sReq = req as SaasRequest;
      const clientCode = sReq.clientCode!;
      const templateData = req.body;
      const result = await whatsappService.createTemplate(
        clientCode,
        templateData,
      );
      res.json(result);
    } catch (error) {
      console.error("Create template error:", error);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  return router;
};
