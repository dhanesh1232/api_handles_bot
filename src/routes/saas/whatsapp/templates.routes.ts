import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { ClientSecrets } from "../../../model/clients/secrets.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";
import { ITemplate } from "../../../model/saas/whatsapp/template.model.ts";
import {
  createTemplate,
  detectOutdatedMappings,
  getCollectionFields,
  getTenantCollections,
  resolveTemplateVariables,
  saveVariableMapping,
  syncTemplatesFromMeta,
  validateMappingCompleteness,
} from "../../../services/saas/whatsapp/template.service.ts";

export interface SaasRequest extends Request {
  clientCode: string;
  user?: any;
}

export const createTemplateRouter = (io: Server) => {
  const router = express.Router();

  // GET /collections - list all collections
  router.get(
    "/collections",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const tenantConn = await getTenantConnection(sReq.clientCode!);
        const collections = await getTenantCollections(
          tenantConn,
          sReq.clientCode!,
        );
        res.json({ success: true, data: collections });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
  );

  // GET /collections/:name/fields - get fields for a specific collection
  router.get(
    "/collections/:name/fields",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const tenantConn = await getTenantConnection(sReq.clientCode!);
        const fields = await getCollectionFields(
          tenantConn,
          sReq.clientCode!,
          req.params.name as string,
        );
        res.json({ success: true, data: fields });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    },
  );

  // POST /sync - Sync templates from Meta
  router.post(
    "/sync",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;

        const secrets = await ClientSecrets.findOne({ clientCode });
        if (!secrets)
          return res
            .status(404)
            .json({ success: false, message: "Client secrets not found" });

        const token = secrets.getDecrypted("whatsappToken");
        const wabaId = secrets.getDecrypted("whatsappBusinessId");

        if (!token || !wabaId) {
          return res.status(400).json({
            success: false,
            message: "WhatsApp credentials not configured",
          });
        }

        const tenantConn = await getTenantConnection(clientCode);
        const result = await syncTemplatesFromMeta(tenantConn, token, wabaId);

        res.json({ success: true, data: result });
      } catch (error: any) {
        console.error("Sync error:", error);
        res.status(500).json({
          success: false,
          message: error.message || "Failed to sync templates",
        });
      }
    },
  );

  // GET / - Read templates from Local DB
  router.get("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const sReq = req as SaasRequest;
      const clientCode = sReq.clientCode!;
      const status = req.query.status as string | undefined;
      const mappingStatus = req.query.mappingStatus as string | undefined;
      const channel = req.query.channel as string | undefined;

      const tenantConn = await getTenantConnection(clientCode);
      const Template = getTenantModel<ITemplate>(
        tenantConn,
        "Template",
        schemas.templates,
      );

      const query: any = {};
      if (status) query.status = status;
      if (mappingStatus) query.mappingStatus = mappingStatus;
      if (channel) query.channel = channel;

      const templates = await Template.find(query).sort({ updatedAt: -1 });
      res.json({ success: true, data: templates });
    } catch (error: any) {
      console.error("Fetch templates error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch templates" });
    }
  });

  // GET /:templateName - Get single template details
  router.get(
    "/:templateName",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;

        const tenantConn = await getTenantConnection(clientCode);
        const Template = getTenantModel<ITemplate>(
          tenantConn,
          "Template",
          schemas.templates,
        );

        const template = await Template.findOne({ name: templateName });
        if (!template)
          return res
            .status(404)
            .json({ success: false, message: "Template not found" });

        res.json({ success: true, data: template });
      } catch (error: any) {
        console.error("Fetch template error:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch template" });
      }
    },
  );

  // PUT /:templateName/mapping - Update variable mapping
  router.put(
    "/:templateName/mapping",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;
        const { mappings, onEmptyVariable } = req.body;

        const tenantConn = await getTenantConnection(clientCode);
        const result = await saveVariableMapping(
          tenantConn,
          templateName,
          mappings,
          onEmptyVariable,
        );

        res.json({ success: true, data: result });
      } catch (error: any) {
        console.error("Update mapping error:", error);
        res.status(400).json({ success: false, message: error.message });
      }
    },
  );

  // GET /:templateName/validate - Validate mapping completeness
  router.get(
    "/:templateName/validate",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;

        const tenantConn = await getTenantConnection(clientCode);
        const result = await validateMappingCompleteness(
          tenantConn,
          templateName,
        );

        res.json({ success: true, data: result });
      } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
      }
    },
  );

  // POST /:templateName/preview - Preview resolved variables
  router.post(
    "/:templateName/preview",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;
        const { context } = req.body;

        const tenantConn = await getTenantConnection(clientCode);
        const resolvedVariables = await resolveTemplateVariables(
          tenantConn,
          templateName,
          context,
        );

        const Template = getTenantModel<ITemplate>(
          tenantConn,
          "Template",
          schemas.templates,
        );
        const template = await Template.findOne({ name: templateName });

        let previewText = template?.bodyText || "";
        resolvedVariables.forEach((val, idx) => {
          const regex = new RegExp(`\\{\\{${idx + 1}\\}\\}`, "g");
          previewText = previewText.replace(regex, val);
        });

        res.json({ success: true, data: { resolvedVariables, previewText } });
      } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
      }
    },
  );

  // GET /outdated - List templates with outdated mappings
  router.get(
    "/list/outdated",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;

        const tenantConn = await getTenantConnection(clientCode);
        const result = await detectOutdatedMappings(tenantConn);

        res.json({ success: true, data: result });
      } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
      }
    },
  );

  // POST / - Create a new template manually
  router.post("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const sReq = req as SaasRequest;
      const clientCode = sReq.clientCode!;
      const templateData = req.body;

      const secrets = await ClientSecrets.findOne({ clientCode });
      const token = secrets?.getDecrypted("whatsappToken") || null;
      const wabaId = secrets?.getDecrypted("whatsappBusinessId") || null;

      const tenantConn = await getTenantConnection(clientCode);
      const result = await createTemplate(
        tenantConn,
        token,
        wabaId,
        templateData,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("Create template error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create template",
      });
    }
  });

  return router;
};
