import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";

import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { ClientSecrets } from "../../../model/clients/secrets.ts";

import {
  checkTemplateUsageInAutomations,
  createTemplate,
  deleteTemplate,
  getCollectionFields,
  getCuratedMappingConfig,
  getTenantCollections,
  removeTemplateFromAutomations,
  resolveUnifiedWhatsAppTemplate,
  saveVariableMapping,
  syncTemplatesFromMeta,
  updateTemplate,
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
        const { conn: tenantConn } = await getCrmModels(sReq.clientCode!);
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
        const { conn: tenantConn } = await getCrmModels(sReq.clientCode!);
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

  // GET /mapping/config - get curated config for mapping UI
  router.get(
    "/mapping/config",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const config = getCuratedMappingConfig();
        res.json({ success: true, data: config });
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

        const { conn: tenantConn } = await getCrmModels(clientCode);
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

      const { Template, conn: tenantConn } = await getCrmModels(clientCode);

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

  // GET /:templateName - Get single template details (supports both Name and ID)
  router.get(
    "/:templateName",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;

        const { Template, conn: tenantConn } = await getCrmModels(clientCode);

        // Try searching by ID if it's a valid ObjectId, otherwise search by name
        let query: any = { name: templateName };
        if (templateName.match(/^[0-9a-fA-F]{24}$/)) {
          query = {
            $or: [{ _id: templateName }, { name: templateName }],
          };
        }

        const template = await Template.findOne(query);
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

        const { conn: tenantConn } = await getCrmModels(clientCode);
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

        const { conn: tenantConn } = await getCrmModels(clientCode);
        const { isReady } = await resolveUnifiedWhatsAppTemplate(
          tenantConn,
          templateName,
          {}, // Empty lead for validation
          {},
        );

        res.json({ success: true, data: { isReady } });
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
        const { context: inputContext } = req.body;

        const { Template, conn: tenantConn } = await getCrmModels(clientCode);
        const { resolvedVariables } = await resolveUnifiedWhatsAppTemplate(
          tenantConn,
          templateName,
          inputContext?.lead || {},
          inputContext?.vars || {},
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

  // POST / - Create a new template manually
  router.post("/", validateClientKey, async (req: Request, res: Response) => {
    try {
      const sReq = req as SaasRequest;
      const clientCode = sReq.clientCode!;
      const templateData = req.body;

      const secrets = await ClientSecrets.findOne({ clientCode });
      const token = secrets?.getDecrypted("whatsappToken") || null;
      const wabaId = secrets?.getDecrypted("whatsappBusinessId") || null;

      const { conn: tenantConn } = await getCrmModels(clientCode);

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

  // PUT /:templateId - Update an existing template
  router.put(
    "/:templateId",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateId = req.params.templateId as string;
        const templateData = req.body;

        const secrets = await ClientSecrets.findOne({ clientCode });
        const token = secrets?.getDecrypted("whatsappToken") || null;
        const wabaId = secrets?.getDecrypted("whatsappBusinessId") || null;

        const { conn: tenantConn } = await getCrmModels(clientCode);

        const result = await updateTemplate(
          tenantConn,
          token,
          wabaId,
          templateId,
          templateData,
        );
        res.json(result);
      } catch (error: any) {
        console.error("Update template error:", error);
        res.status(error.status || 500).json({
          success: false,
          message: error.message || "Failed to update template",
        });
      }
    },
  );

  // GET /:templateName/usage - Check if template is used in automation rules
  router.get(
    "/:templateName/usage",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;

        const { conn: tenantConn } = await getCrmModels(clientCode);

        const usage = await checkTemplateUsageInAutomations(
          tenantConn,
          templateName,
        );
        res.json({ success: true, data: usage });
      } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
      }
    },
  );

  // DELETE /:templateName - Delete a template
  // Query param: force=true → also removes the template from all automation rules before deleting
  router.delete(
    "/:templateName",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const templateName = req.params.templateName as string;
        const force = req.query.force === "true";

        const secrets = await ClientSecrets.findOne({ clientCode });
        const token = secrets?.getDecrypted("whatsappToken") || null;
        const wabaId = secrets?.getDecrypted("whatsappBusinessId") || null;

        const { conn: tenantConn } = await getCrmModels(clientCode);

        if (force) {
          const cleanup = await removeTemplateFromAutomations(
            tenantConn,
            templateName,
          );
          console.log(
            `[Delete] Removed template "${templateName}" from ${cleanup.modifiedCount} automation rule(s).`,
          );
        }

        const result = await deleteTemplate(
          tenantConn,
          token,
          wabaId,
          templateName,
          clientCode,
        );
        res.json({ success: true, data: result });
      } catch (error: any) {
        console.error("Delete template error:", error);
        res.status(500).json({
          success: false,
          message: error.message || "Failed to delete template",
        });
      }
    },
  );

  return router;
};
