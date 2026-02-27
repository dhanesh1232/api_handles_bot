import axios from "axios";
import { type Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { getTenantModel } from "../../../lib/connectionManager.ts";
import {
  TemplateMappingIncompleteError,
  TemplateNotFoundError,
  TemplateSyncFailedError,
  TemplateVariableEmptyError,
} from "../../../lib/errors.ts";
import { SchemaScanner } from "../../../lib/tenant/schemaScanner.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";
import { ITemplate } from "../../../model/saas/whatsapp/template.model.ts";
const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

/**
 * Helper to get deep property from object using dot notation
 */
const getDeep = (obj: any, path: string) => {
  return path.split(".").reduce((acc, part) => acc && acc[part], obj);
};

export const extractVariablePositions = (text: string): number[] => {
  const matches = text.match(/{{(\d+)}}/g) || [];
  const positions = matches.map((m) => parseInt(m.replace(/{{|}}/g, ""), 10));
  return [...new Set(positions)].sort((a, b) => a - b);
};

export const extractEnrichedFields = (components: any[]) => {
  let headerType: any = "NONE";
  let headerText = "";
  let bodyText = "";
  let footerText = "";

  const headerComp = components.find((c: any) => c.type === "HEADER");
  if (headerComp) {
    headerType = headerComp.format || "TEXT";
    headerText = headerComp.text || "";
  }

  const bodyComp = components.find((c: any) => c.type === "BODY");
  if (bodyComp) {
    bodyText = bodyComp.text || "";
  }

  const footerComp = components.find((c: any) => c.type === "FOOTER");
  if (footerComp) {
    footerText = footerComp.text || "";
  }

  const fullText = `${headerText} ${bodyText}`;
  const variablePositions = extractVariablePositions(fullText);

  return {
    headerType,
    headerText,
    bodyText,
    footerText,
    variablePositions,
    variableCount: variablePositions.length,
  };
};

export const syncTemplatesFromMeta = async (
  tenantDb: Connection,
  whatsappToken: string,
  businessAccountId: string,
): Promise<SyncResult> => {
  try {
    const Template = getTenantModel<ITemplate>(
      tenantDb,
      "Template",
      schemas.templates,
    );

    const response = await axios.get(
      `${WHATSAPP_API_URL}/${businessAccountId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${whatsappToken}` },
      },
    );

    const metaTemplates = response.data.data || [];
    const result: SyncResult = {
      synced: metaTemplates.length,
      updated: 0,
      outdated: [],
      new: [],
    };

    for (const t of metaTemplates) {
      const enriched = extractEnrichedFields(t.components);
      const existing = await Template.findOne({
        name: t.name,
        language: t.language,
      });

      let mappingStatus: MappingStatus = "unmapped";
      if (existing) {
        mappingStatus = existing.mappingStatus;
        if (enriched.variableCount !== existing.variablesCount) {
          mappingStatus = "outdated";
          result.outdated.push(t.name);
        }
        result.updated++;
      } else {
        result.new.push(t.name);
      }

      await Template.findOneAndUpdate(
        { name: t.name, language: t.language },
        {
          name: t.name,
          templateId: t.id,
          status: t.status,
          language: t.language,
          category: t.category as TemplateCategory,
          channel: "whatsapp",
          bodyText: enriched.bodyText,
          headerText: enriched.headerText,
          footerText: enriched.footerText,
          headerType: enriched.headerType,
          variablesCount: enriched.variableCount,
          variablePositions: enriched.variablePositions,
          components: t.components,
          mappingStatus,
          lastSyncedAt: new Date(),
          isActive: true,
        },
        { upsert: true, returnDocument: "after" },
      );
    }

    return result;
  } catch (error: any) {
    console.error(
      "Template sync failed:",
      error.response?.data || error.message,
    );
    throw new TemplateSyncFailedError(
      error.response?.data?.error?.message || error.message,
    );
  }
};

export const saveVariableMapping = async (
  tenantDb: Connection,
  templateName: string,
  mappings: IVariableMapping[],
  onEmptyVariable: OnEmptyVariable = "use_fallback",
) => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );
  const template = await Template.findOne({ name: templateName });

  if (!template) throw new TemplateNotFoundError(templateName);

  // Validate mappings
  for (const pos of template.variablePositions) {
    const mapping = mappings.find((m) => m.position === pos);
    if (!mapping) continue; // Will be caught by completeness check if required

    if (mapping.source === "crm" && !mapping.field) {
      throw new Error(`Field is required for CRM source at position ${pos}`);
    }
    if (mapping.source === "static" && !mapping.staticValue) {
      throw new Error(
        `Static value is required for static source at position ${pos}`,
      );
    }
  }

  // Calculate status
  const mappedPositions = mappings.map((m) => m.position);
  const allPositionsMapped = template.variablePositions.every((pos) =>
    mappedPositions.includes(pos),
  );
  const mappingStatus: MappingStatus = allPositionsMapped
    ? "complete"
    : mappings.length > 0
      ? "partial"
      : "unmapped";

  template.variableMapping = mappings;
  template.onEmptyVariable = onEmptyVariable;
  template.mappingStatus = mappingStatus;
  template.lastMappingUpdatedAt = new Date();

  await template.save();
  return template;
};

export const resolveTemplateVariables = async (
  tenantDb: Connection,
  templateName: string,
  contextData: any,
): Promise<string[]> => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );
  const template = await Template.findOne({ name: templateName });

  if (!template) throw new TemplateNotFoundError(templateName);
  // Allow partial for now if only some variables are used? No, requirement says validate complete
  if (template.mappingStatus !== "complete" && template.variablesCount! > 0) {
    throw new TemplateMappingIncompleteError(
      templateName,
      template.variablePositions.filter(
        (pos) => !template.variableMapping.find((m) => m.position === pos),
      ),
    );
  }

  const resolved: string[] = [];
  const manualOverrides = contextData._manualOverrides || {};

  // Sort mappings by position to ensure correct order in returned array
  const sortedMappings = [...template.variableMapping].sort(
    (a, b) => a.position - b.position,
  );

  for (const mapping of sortedMappings) {
    let value: any = null;

    if (manualOverrides[mapping.position]) {
      value = manualOverrides[mapping.position];
    } else {
      const mappingType = (mapping as any).type || mapping.source; // Backward compatibility

      switch (mappingType) {
        case "dynamic":
        case "crm": {
          const collection = mapping.source || "leads";
          const entityData = contextData[collection] || contextData; // Fallback to root context if collection not found
          value = getDeep(entityData, mapping.field!);
          break;
        }
        case "static":
          value = mapping.staticValue;
          break;
        case "system":
          if (mapping.field === "system.currentDate") {
            value = new Intl.DateTimeFormat("en-IN").format(new Date());
          } else if (mapping.field === "system.currentTime") {
            value = new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            });
          } else if (mapping.field === "system.uniqueId") {
            value = uuidv4().split("-")[0];
          }
          break;
        case "computed":
          if (mapping.formula) {
            value = evaluateFormula(mapping.formula, contextData);
          }
          break;
        case "manual":
          value = null;
          break;
      }
    }

    if (value === null || value === undefined || value === "") {
      value = mapping.fallback || "";
    }

    if (value === "" && mapping.required) {
      if (template.onEmptyVariable === "skip_send") {
        throw new TemplateVariableEmptyError(mapping.position, mapping.field);
      }
    }

    resolved.push(String(value));
  }

  return resolved;
};

const evaluateFormula = (formula: string, context: any): string => {
  try {
    // Basic regex-based formula parser for: func(field) or func(field, arg)
    const match = formula.match(/^(\w+)\((.*)\)$/);
    if (!match) return "";

    const func = match[1];
    const args = match[2].split(",").map((a) => a.trim());
    const fieldPath = args[0];
    const data = getDeep(context, fieldPath) || "";

    switch (func) {
      case "formatDate":
        return new Date(data).toLocaleDateString("en-IN");
      case "formatTime":
        return new Date(data).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        });
      case "uppercase":
        return String(data).toUpperCase();
      case "lowercase":
        return String(data).toLowerCase();
      case "concat":
        return args
          .slice(1)
          .reduce(
            (acc, arg) => acc + (getDeep(context, arg) || arg),
            String(data),
          );
      case "truncate":
        const limit = parseInt(args[1], 10) || 20;
        return String(data).substring(0, limit);
      default:
        return String(data);
    }
  } catch (e) {
    return "";
  }
};

export const validateMappingCompleteness = async (
  tenantDb: Connection,
  templateName: string,
) => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );
  const template = await Template.findOne({ name: templateName });

  if (!template) throw new TemplateNotFoundError(templateName);

  const missingPositions = template.variablePositions.filter(
    (pos) => !template.variableMapping.find((m) => m.position === pos),
  );

  return {
    isReady: missingPositions.length === 0,
    missingPositions,
    mappingStatus: template.mappingStatus,
  };
};

export const detectOutdatedMappings = async (tenantDb: Connection) => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );
  const outdated = await Template.find({ mappingStatus: "outdated" });

  return outdated.map((t) => ({
    templateName: t.name,
    variablesCount: t.variablesCount,
    lastSyncedAt: t.lastSyncedAt,
  }));
};

export const createTemplate = async (
  tenantDb: Connection,
  whatsappToken: string | null,
  businessAccountId: string | null,
  templateData: any,
) => {
  try {
    const Template = getTenantModel<ITemplate>(
      tenantDb,
      "Template",
      schemas.templates,
    );
    let status = templateData.status || "PENDING";

    if (templateData.channel === "whatsapp") {
      if (!whatsappToken || !businessAccountId) {
        throw new Error("WhatsApp credentials not found.");
      }

      // Submit to Meta for approval
      console.log(`Submitting WhatsApp template to Meta: ${templateData.name}`);
      const res = await axios.post(
        `${WHATSAPP_API_URL}/${businessAccountId}/message_templates`,
        {
          name: templateData.name,
          category: templateData.category || "UTILITY",
          language: templateData.language || "en_US",
          components: templateData.components,
        },
        {
          headers: { Authorization: `Bearer ${whatsappToken}` },
          timeout: 15000,
        },
      );

      status = res.data.status || "PENDING_APPROVAL";
    }

    let enriched = {};
    if (templateData.channel === "whatsapp" && templateData.components) {
      enriched = extractEnrichedFields(templateData.components);
    }

    const template = await Template.findOneAndUpdate(
      {
        name: templateData.name,
        language: templateData.language || "en_US",
        channel: templateData.channel,
      },
      {
        ...templateData,
        ...enriched,
        status,
      },
      { upsert: true, returnDocument: "after" },
    );

    return { success: true, data: template };
  } catch (err: any) {
    const metaError =
      err.response?.data?.error?.message || err.response?.data || err.message;
    console.error("Create Template Error:", metaError);
    throw new Error(metaError);
  }
};

/**
 * ─── Two-Step Dynamic Discovery ────────────────────────────────────────────────
 */

export const getTenantCollections = async (
  tenantDb: Connection,
  clientCode: string,
) => {
  console.log(`[getTenantCollections] Discovering for ${clientCode}`);
  const dbCollections = (await tenantDb.db?.listCollections().toArray()) || [];
  const projectCollections =
    await SchemaScanner.listProjectCollections(clientCode);

  const allCollectionNames = Array.from(
    new Set([...dbCollections.map((c) => c.name), ...projectCollections]),
  ).sort();

  const skipCollections = [
    "system.indexes",
    "templates",
    "clientdatasources",
    "users",
    "sessions",
    "counters",
  ];

  return allCollectionNames
    .filter((name) => !skipCollections.includes(name))
    .map((name) => ({
      name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
    }));
};

export const getCollectionFields = async (
  tenantDb: Connection,
  clientCode: string,
  collName: string,
) => {
  console.log(
    `[getCollectionFields] Fetching fields for ${collName} (${clientCode})`,
  );

  const fieldsSet = new Map<
    string,
    { key: string; label: string; type: string }
  >();

  // 1. Core Fields from Source Code (Source of Truth)
  const sourceFields = await SchemaScanner.getFieldsForCollection(
    clientCode,
    collName,
  );
  sourceFields.forEach((f: any) => fieldsSet.set(f.key, f));

  // 2. Discover dynamic fields from documents
  try {
    const docs = await tenantDb
      .collection(collName)
      .find({})
      .sort({ _id: -1 })
      .limit(10)
      .toArray();

    docs.forEach((doc) => {
      Object.keys(doc).forEach((key) => {
        if (["clientCode", "__v", "_id"].includes(key)) return;

        if (key === "metadata" && doc.metadata?.extra) {
          Object.keys(doc.metadata.extra).forEach((ex) => {
            const fullKey = `metadata.extra.${ex}`;
            if (!fieldsSet.has(fullKey)) {
              fieldsSet.set(fullKey, {
                key: fullKey,
                label: ex
                  .replace(/([A-Z])/g, " $1")
                  .replace(/^./, (str) => str.toUpperCase()),
                type: "dynamic",
              });
            }
          });
        } else if (
          typeof doc[key] !== "object" ||
          Array.isArray(doc[key]) ||
          doc[key] instanceof Date
        ) {
          if (!fieldsSet.has(key)) {
            fieldsSet.set(key, {
              key,
              label: key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (str) => str.toUpperCase()),
              type: "dynamic",
            });
          }
        }
      });
    });
  } catch (err) {
    console.error(`Error sampling documents for ${collName}:`, err);
  }

  return Array.from(fieldsSet.values());
};
