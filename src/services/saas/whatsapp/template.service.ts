import axios from "axios";
import mongoose, { type Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { getTenantModel } from "../../../lib/connectionManager.ts";
import {
  TemplateNotFoundError,
  TemplateSyncFailedError,
} from "../../../lib/errors.ts";
import { SchemaScanner } from "../../../lib/tenant/schemaScanner.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";
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
  const variables: any[] = [];
  let nextPos = 1;

  const extractFromText = (
    text: string,
    componentType: string,
    compIndex?: number,
  ) => {
    const matches = text.match(/{{(\d+)}}/g) || [];
    const uniqueIndices = [
      ...new Set(matches.map((m) => parseInt(m.replace(/{{|}}/g, ""), 10))),
    ].sort((a, b) => a - b);

    uniqueIndices.forEach((idx) => {
      variables.push({
        position: nextPos++,
        label: `${componentType.charAt(0) + componentType.slice(1).toLowerCase()} Variable ${idx}${compIndex !== undefined ? ` (Button ${compIndex + 1})` : ""}`,
        componentType,
        componentIndex: compIndex,
        originalIndex: idx,
      });
    });
  };

  const headerComp = components.find((c: any) => c.type === "HEADER");
  if (headerComp) {
    headerType = headerComp.format || "TEXT";
    headerText = headerComp.text || "";
    if (headerText) extractFromText(headerText, "HEADER");
  }

  const bodyComp = components.find((c: any) => c.type === "BODY");
  if (bodyComp) {
    bodyText = bodyComp.text || "";
    if (bodyText) extractFromText(bodyText, "BODY");
  }

  const footerComp = components.find((c: any) => c.type === "FOOTER");
  if (footerComp) {
    footerText = footerComp.text || "";
    if (footerText) extractFromText(footerText, "FOOTER");
  }

  const buttonsArr: any[] = [];
  const buttonsComp = components.find((c: any) => c.type === "BUTTONS");
  if (buttonsComp && buttonsComp.buttons) {
    buttonsComp.buttons.forEach((btn: any, idx: number) => {
      buttonsArr.push({
        type: btn.type,
        text: btn.text,
        url: btn.url,
        phoneNumber: btn.phone_number,
      });
      if (btn.url) extractFromText(btn.url, "BUTTON", idx);
      if (btn.text) extractFromText(btn.text, "BUTTON", idx);
    });
  }

  return {
    headerType,
    headerText,
    bodyText,
    footerText,
    buttons: buttonsArr,
    variableMappingSkeleton: variables,
    variablePositions: variables.map((v) => v.position),
    variableCount: variables.length,
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
          buttons: (enriched as any).buttons,
          variablesCount: enriched.variableCount,
          variablePositions: enriched.variablePositions,
          // Only initialize mapping if it's new or outdated
          ...(mappingStatus === "unmapped" || mappingStatus === "outdated"
            ? { variableMapping: (enriched as any).variableMappingSkeleton }
            : {}),
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

    const validSources = ["crm", "static", "computed", "system", "manual"];
    if (!mapping.source || !validSources.includes(mapping.source)) {
      throw new Error(
        `Invalid or missing source type for variable at position ${pos}`,
      );
    }

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
  const allPositionsMapped = template.variablePositions.every((pos: number) =>
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

/**
 * ─── Unified & Recursive Template Resolver ────────────────────────────────────
 * The single source of truth for resolving any WhatsApp template.
 */
export const resolveUnifiedWhatsAppTemplate = async (
  tenantDb: Connection,
  templateName: string,
  lead: any,
  eventVariables?: Record<string, any>,
): Promise<{
  resolvedVariables: string[];
  languageCode: string;
  isReady: boolean;
  contextSnapshot: any;
  template: ITemplate;
}> => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );
  const template = await Template.findOne({ name: templateName });
  if (!template) throw new TemplateNotFoundError(templateName);

  // 1. Initial Context
  const context: any = {
    lead,
    event: eventVariables || {},
    vars: eventVariables || {},
    resolved: {
      today: new Date().toLocaleDateString("en-IN"),
      now: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...(eventVariables || {}),
    },
  };

  // 2. Multi-Pass Recursive Discovery
  const requiredCollections = [
    ...new Set(
      template.variableMapping
        .filter(
          (m: IVariableMapping) =>
            m.source === "crm" && m.collection && m.collection !== "leads",
        )
        .map((m: IVariableMapping) => m.collection!),
    ),
  ];

  const getRefId = (collName: string) => {
    const singular = collName.endsWith("ies")
      ? collName.replace(/ies$/, "y")
      : collName.replace(/s$/, "");
    return `${singular}Id`;
  };

  const fetchedIds = new Set<string>();

  const discover = async (maxPasses = 3) => {
    for (let pass = 0; pass < maxPasses; pass++) {
      let newlyFound = false;

      for (const collName of requiredCollections as string[]) {
        if (context[collName]) continue;

        const refKey = getRefId(collName);
        let targetId: any = eventVariables?.[refKey];

        if (!targetId && lead?.metadata?.refs)
          targetId = lead.metadata.refs[refKey];

        // Search through existing context documents for references
        if (!targetId) {
          for (const doc of Object.values(context)) {
            if (doc && typeof doc === "object" && (doc as any)[refKey]) {
              targetId = (doc as any)[refKey];
              break;
            }
          }
        }

        if (targetId && !fetchedIds.has(targetId.toString())) {
          try {
            const doc = await tenantDb.collection(collName).findOne({
              _id: new mongoose.Types.ObjectId(targetId.toString()),
            });
            if (doc) {
              context[collName] = doc;
              fetchedIds.add(targetId.toString());
              newlyFound = true;
            }
          } catch (e) {
            // Skip invalid IDs
          }
        }
      }
      if (!newlyFound) break;
    }
  };

  await discover();

  // 3. Resolve Variables
  const resolvedVariables: string[] = [];
  const sortedMappings = [...template.variableMapping].sort(
    (a, b) => a.position - b.position,
  );

  for (const mapping of sortedMappings) {
    let value: any = null;
    const mappingType = (mapping as any).type || mapping.source;

    switch (mappingType) {
      case "crm":
      case "dynamic": {
        const coll = mapping.collection || "leads";
        const data = context[coll] || (coll === "leads" ? lead : null);
        value = data ? getDeep(data, mapping.field!) : null;
        break;
      }
      case "static":
        value = mapping.staticValue;
        break;
      case "system":
        if (mapping.field === "system.currentDate")
          value = context.resolved.today;
        else if (mapping.field === "system.currentTime")
          value = context.resolved.now;
        else if (mapping.field === "system.uniqueId")
          value = uuidv4().split("-")[0];
        break;
      case "computed":
        if (mapping.formula) value = evaluateFormula(mapping.formula, context);
        break;
    }

    if (value instanceof Date) {
      value = value.toLocaleDateString("en-IN", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }

    value =
      value === null || value === undefined || value === ""
        ? mapping.fallback || ""
        : value;

    // Strictness check
    const strVal = String(value);
    if (strVal.includes("{{") || strVal.includes("vars.")) {
      // If it's still a raw placeholder and required, we might want to fail, but let's be lenient if fallback exists
    }

    resolvedVariables.push(strVal);
  }

  // 4. Missing Check
  const missing = template.variablePositions.filter(
    (pos: number) =>
      !template.variableMapping.find(
        (m: IVariableMapping) => m.position === pos,
      ),
  );

  return {
    resolvedVariables,
    languageCode: template.language || "en_US",
    isReady: missing.length === 0,
    contextSnapshot: context,
    template,
  };
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

/**
 *
 * @param tenantDb
 * @param whatsappToken
 * @param businessAccountId
 * @param templateData
 * @returns {Object} - { template: ITemplate }
 */
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

  const allCollectionNames = dbCollections.map((c) => c.name).sort();

  const skipCollections = [
    "system.indexes",
    "templates",
    "clientdatasources",
    "users",
    "sessions",
    "counters",
    "eventlogs",
    "activities",
    "notifications",
    "chats",
    "messages",
    "groups",
    "pipelines",
    "pipelinestages",
    "automationrules",
    "sequencerenrollments",
    "scoringconfigs",
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
