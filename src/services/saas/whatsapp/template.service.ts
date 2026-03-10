import axios from "axios";
import mongoose, { type Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { getTenantModel } from "../../../lib/connectionManager.ts";
import {
  TemplateNotFoundError,
  TemplateSyncFailedError,
} from "../../../lib/errors.ts";
import { SchemaScanner } from "../../../lib/tenant/schemaScanner.ts";
import { ClientServiceConfig } from "../../../model/clients/config.ts";
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

export const extractEmailEnrichedFields = (components: any[]) => {
  const variables: any[] = [];
  let nextPos = 1;

  const extractFromText = (
    text: string,
    componentType: string,
    compIndex?: number,
  ) => {
    if (typeof text !== "string") return;
    const matches = text.match(/{{(\d+)}}/g) || [];
    const uniqueIndices = [
      ...new Set(matches.map((m) => parseInt(m.replace(/{{|}}/g, ""), 10))),
    ].sort((a, b) => a - b);

    uniqueIndices.forEach((idx) => {
      // Avoid pushing duplicates if a variable is used multiple times in the same block
      const exists = variables.find(v => v.originalIndex === idx && v.componentIndex === compIndex);
      if (!exists) {
        variables.push({
          position: nextPos++,
          label: `${componentType.charAt(0).toUpperCase() + componentType.slice(1).toLowerCase()} Variable ${idx}${compIndex !== undefined ? ` (Block ${compIndex + 1})` : ""}`,
          componentType,
          componentIndex: compIndex,
          originalIndex: idx,
        });
      }
    });
  };

  if (Array.isArray(components)) {
    components.forEach((block: any, blockIdx: number) => {
      // For recursive blocks like columns
      const extractProps = (props: any) => {
        if (!props) return;
        Object.entries(props).forEach(([key, val]) => {
          if (typeof val === "string") {
            extractFromText(val, block.type || "BLOCK", blockIdx);
          } else if (val && typeof val === "object" && !Array.isArray(val) && "type" in val && "props" in val) {
            // Nested block (e.g., inside columns-2)
            extractProps((val as any).props);
          }
        });
      };
      
      if (block.props) {
        extractProps(block.props);
      }
    });
  }

  return {
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

    const syncedIds: any[] = [];

    for (const t of metaTemplates) {
      const enriched = extractEnrichedFields(t.components);
      const existing = await Template.findOne({
        name: t.name,
        language: t.language,
        channel: "whatsapp",
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

      const doc = await Template.findOneAndUpdate(
        { name: t.name, language: t.language, channel: "whatsapp" },
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

      if (doc?._id) syncedIds.push(doc._id);
    }

    // Task: Remove local WhatsApp templates that are no longer in Meta
    const deletedResult = await Template.deleteMany({
      channel: "whatsapp",
      _id: { $nin: syncedIds },
    });

    if (deletedResult.deletedCount > 0) {
      console.log(
        `[Sync] Removed ${deletedResult.deletedCount} local templates not found in Meta for client.`,
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

    const validSources = [
      "crm",
      "static",
      "computed",
      "system",
      "manual",
      "trigger",
    ];
    if (!mapping.source || !validSources.includes(mapping.source)) {
      throw new Error(
        `Invalid or missing source type for variable at position ${pos}`,
      );
    }

    if (mapping.source === "crm" && !mapping.field) {
      throw new Error(`Field is required for CRM source at position ${pos}`);
    }
    if (mapping.source === "trigger" && !mapping.field) {
      throw new Error(
        `Field is required for Trigger source at position ${pos}`,
      );
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

        if (!targetId && collName === "meetings") {
          targetId = eventVariables?.meetingId || eventVariables?.eventId;
        }

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

        // If the CRM field resolved to nothing, try eventVariables as a fallback.
        // Handles cases where e.g. meetings.meetCode is empty but meet_code was
        // passed directly in the automation trigger's event variables.
        if ((value === null || value === undefined || value === "") && eventVariables && mapping.field) {
          const field = mapping.field;
          // Try exact key, then snake_case conversion of camelCase
          const snakeKey = field.replace(/([A-Z])/g, "_$1").toLowerCase();
          value =
            eventVariables[field] ??
            eventVariables[snakeKey] ??
            null;
          if (value !== null && value !== undefined) {
            console.log(
              `[TemplateResolver] CRM field "${field}" was empty; resolved from eventVariables key "${snakeKey || field}".`,
            );
          }
        }
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
      case "trigger":
        value = getDeep(context.event, mapping.field!);
        break;
      case "computed":
        if (mapping.formula) value = evaluateFormula(mapping.formula, context);
        break;
    }

    if (value instanceof Date) {
      const fieldName = mapping.field?.toLowerCase() || "";
      const isTimeOnly =
        fieldName.includes("time") && !fieldName.includes("date");
      const isDateOnly =
        (fieldName.includes("date") || fieldName.includes("day")) &&
        !fieldName.includes("time");

      if (isTimeOnly) {
        value = value.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
      } else if (isDateOnly) {
        value = value.toLocaleDateString("en-IN", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      } else {
        // "Smart" default: include time only if it's not midnight
        const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
        if (hasTime) {
          value = value.toLocaleString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
        } else {
          value = value.toLocaleDateString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        }
      }
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

/**
 * ─── Email Template Resolver ──────────────────────────────────────────────────
 * Resolves both Subject and Body for Email templates.
 */
export const resolveUnifiedEmailTemplate = async (
  tenantDb: Connection,
  templateName: string,
  lead: any,
  eventVariables?: Record<string, any>,
): Promise<{
  subject: string;
  body: string;
  isReady: boolean;
  template: ITemplate;
}> => {
  const resolution = await resolveUnifiedWhatsAppTemplate(
    tenantDb,
    templateName,
    lead,
    eventVariables,
  );

  if (!resolution.isReady) {
    return {
      subject: "",
      body: "",
      isReady: false,
      template: resolution.template,
    };
  }

  const template = resolution.template;
  let subject = template.subject || "";
  let headerText = template.headerText || "";
  let bodyText = template.bodyText || "";
  let footerText = template.footerText || "";

  const sortedMappings = [...template.variableMapping].sort(
    (a, b) => a.position - b.position,
  );

  sortedMappings.forEach((m, idx) => {
    const val = resolution.resolvedVariables[idx];
    const placeholder = new RegExp(`\\{\\{${m.position}\\}\\}`, "g");

    subject = subject.replace(placeholder, val || "");
    headerText = headerText.replace(placeholder, val || "");
    footerText = footerText.replace(placeholder, val || "");

    const escapedVal =
      template.contentType === "html" && val
        ? val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : val;
    bodyText = bodyText.replace(placeholder, escapedVal || "");
  });

  // ─── Block-Based Rendering (New) ──────────────────────────────────────────
  if (
    template.components &&
    Array.isArray(template.components) &&
    template.components.length > 0 &&
    template.channel === "email"
  ) {
    let emailHtml = "";

    const renderBlock = (block: any) => {
      let content = "";
      const props = block.props || {};

      // Replace variables in props
      const resolvedProps: any = JSON.parse(JSON.stringify(props));
      const resolveText = (text: string) => {
        if (!text) return "";
        let t = text;
        sortedMappings.forEach((m, idx) => {
          const val = resolution.resolvedVariables[idx];
          const placeholder = new RegExp(`\\{\\{${m.position}\\}\\}`, "g");
          t = t.replace(placeholder, val || "");
        });
        return t;
      };

      switch (block.type) {
        case "header":
          content = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
              <tr>
                <td align="center">
                  ${props.logoUrl ? `<img src="${props.logoUrl}" alt="Logo" style="display: block; max-height: 50px; margin-bottom: 10px;">` : ""}
                  <h1 style="margin: 0; font-size: 20px; color: ${props.color || "#09090b"};">${resolveText(props.companyName || "")}</h1>
                </td>
              </tr>
            </table>`;
          break;
        case "hero":
          content = `
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${props.backgroundColor || "#f8fafc"}; border-radius: 8px; margin-bottom: 20px;">
              <tr>
                <td style="padding: 40px 20px; text-align: center;">
                  <h1 style="margin: 0 0 15px; font-size: 28px; color: ${props.titleColor || "#0f172a"};">${resolveText(props.title || "Headline")}</h1>
                  <p style="margin: 0 0 25px; font-size: 16px; color: ${props.subtitleColor || "#475569"};">${resolveText(props.subtitle || "Subtext")}</p>
                  ${props.buttonText ? `<a href="${props.buttonUrl || "#"}" style="display: inline-block; padding: 12px 24px; background-color: ${props.buttonColor || "#6366f1"}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">${resolveText(props.buttonText)}</a>` : ""}
                </td>
              </tr>
            </table>`;
          break;
        case "text":
          content = `<div style="padding: 10px 0; font-size: 16px; line-height: 1.6; color: ${props.color || "#334155"}; text-align: ${props.align || "left"};">${resolveText(props.content || "")}</div>`;
          break;
        case "image":
          content = `
            <div style="margin: 20px 0; text-align: ${props.align || "center"};">
              <img src="${props.url || ""}" alt="${resolveText(props.alt || "Image")}" style="display: block; width: 100%; max-width: ${props.width || "600px"}; border-radius: ${props.borderRadius || "0"}px;">
              ${props.caption ? `<p style="margin-top: 8px; font-size: 12px; color: #64748b;">${resolveText(props.caption)}</p>` : ""}
            </div>`;
          break;
        case "button":
          content = `
            <div style="margin: 20px 0; text-align: ${props.align || "center"};">
              <a href="${props.url || "#"}" style="display: inline-block; padding: 14px 28px; background-color: ${props.backgroundColor || "#6366f1"}; color: ${props.color || "#ffffff"}; text-decoration: none; border-radius: ${props.borderRadius || "8"}px; font-weight: 700;">${resolveText(props.text || "Click Me")}</a>
            </div>`;
          break;
        case "divider":
          content = `<hr style="margin: 20px 0; border: 0; border-top: ${props.thickness || "1"}px ${props.style || "solid"} ${props.color || "#e2e8f0"};">`;
          break;
        case "spacer":
          content = `<div style="height: ${props.height || "20"}px;"></div>`;
          break;
        case "social":
          content = `
            <div style="margin: 20px 0; text-align: center;">
              ${(props.links || [])
                .filter((l: any) => l.active)
                .map(
                  (l: any) => `
                <a href="${l.url || "#"}" style="display: inline-block; margin: 0 10px; text-decoration: none; color: #64748b;">
                  <span style="font-size: 12px; text-transform: uppercase; font-weight: 700;">${l.platform}</span>
                </a>
              `,
                )
                .join("")}
            </div>`;
          break;
        case "footer":
          content = `
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
              <p style="margin: 0 0 10px;">${resolveText(props.address || "")}</p>
              <p style="margin: 0;">
                <a href="${props.unsubscribeUrl || "#"}" style="color: #6366f1; text-decoration: underline;">Unsubscribe</a> | 
                <a href="${props.legalUrl || "#"}" style="color: #6366f1; text-decoration: underline;">Legal</a>
              </p>
              <p style="margin-top: 10px;">${resolveText(props.copyright || "© 2026 Nirvisham")}</p>
            </div>`;
          break;
        case "testimonial":
          content = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; background-color: #f1f5f9; border-radius: 12px;">
              <tr>
                <td style="padding: 25px; text-align: center;">
                  <p style="font-size: 18px; font-style: italic; color: #1e293b; margin-bottom: 20px;">"${resolveText(props.quote || "")}"</p>
                  ${props.avatar ? `<img src="${props.avatar}" style="width: 48px; hieght: 48px; border-radius: 50%; margin-bottom: 10px;">` : ""}
                  <p style="margin: 0; font-weight: 700; color: #0f172a;">${resolveText(props.name || "")}</p>
                  <p style="margin: 0; font-size: 12px; color: #64748b;">${resolveText(props.role || "")}</p>
                </td>
              </tr>
            </table>`;
          break;
        case "columns-2":
          content = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
              <tr>
                <td width="50%" align="center" style="padding-right: 10px;">
                  ${props.leftBlock ? renderBlock(props.leftBlock) : ""}
                </td>
                <td width="50%" align="center" style="padding-left: 10px;">
                  ${props.rightBlock ? renderBlock(props.rightBlock) : ""}
                </td>
              </tr>
            </table>`;
          break;
        // Simplified others for brevity, to be expanded if specific structure needed
        default:
          content = `<div style="padding: 10px; border: 1px dashed #ccc; text-align: center;">${block.type} component</div>`;
      }
      return content;
    };

    template.components.forEach((block: any) => {
      emailHtml += renderBlock(block);
    });

    const finalBlockBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
      </head>
      <body style="margin:0;padding:0;background-color:#f8fafc;font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc;">
          <tr>
            <td align="center" style="padding: 20px 10px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <tr>
                  <td style="padding: 30px;">
                    ${emailHtml}
                  </td>
                </tr>
              </table>
              <div style="text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
                Powered by Nirvisham Communication Systems
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    return {
      subject,
      body: finalBlockBody,
      isReady: true,
      template,
    };
  }

  // ─── Legacy Fallback ───────────────────────────────────────────────────────
  // Prepare HTML components
  const headerHtml =
    template.headerType === "TEXT" && headerText
      ? `<h1 style="color: #0d1117; font-size: 26px; font-weight: 800; margin-bottom: 24px; text-align: left; line-height: 1.2; letter-spacing: -0.02em;">${headerText}</h1>`
      : "";

  const footerHtml = footerText
    ? `<div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e1e4e8; font-size: 13px; color: #57606a; text-align: center; font-weight: 500;">${footerText.replace(/\n/g, "<br/>")}</div>`
    : "";

  const buttonsHtml =
    template.buttons && template.buttons.length > 0
      ? `
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px;">
        ${template.buttons
          .map(
            (btn) => `
          <a href="${btn.url}" target="_blank" style="display: block; background: #2563eb; color: #ffffff; text-align: center; padding: 14px 24px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2); transition: all 0.2s ease;">${btn.text || "Action Button"}</a>
        `,
          )
          .join("")}
      </div>
    `
      : "";

  const socialHtml =
    template.socialLinks &&
    template.socialLinks.filter((l) => l.active && l.url).length > 0
      ? `
      <div style="margin-top: 24px; text-align: center; border-top: 1px solid #e1e4e8; padding-top: 24px; display: flex; justify-content: center; gap: 20px;">
        ${template.socialLinks
          .filter((l) => l.active && l.url)
          .map((l) => {
            const colors: Record<string, string> = {
              facebook: "#1877F2",
              twitter: "#1DA1F2",
              instagram: "#E4405F",
              linkedin: "#0A66C2",
            };
            const color = colors[l.platform] || "#666";
            return `<a href="${l.url}" target="_blank" style="display: inline-block; margin: 0 10px; color: ${color}; text-decoration: none; font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">${l.platform}</a>`;
          })
          .join("")}
      </div>
    `
      : "";

  // Content preparation
  const mainContent =
    template.contentType === "html"
      ? bodyText
      : bodyText.replace(/\n/g, "<br/>");

  const finalBody = `
    <div style="background-color: #f6f8fa; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #d0d7de; box-shadow: 0 8px 24px rgba(140, 149, 159, 0.1); overflow: hidden;">
        <div style="padding: 40px;">
          ${headerHtml}
          <div style="font-size: 16px; line-height: 1.6; color: #24292f; font-weight: 450;">
            ${mainContent}
          </div>
          ${buttonsHtml}
          ${footerHtml}
          ${socialHtml}
        </div>
      </div>
      <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #57606a;">
        Sent via Nirvisham Communication Systems
      </div>
    </div>
  `;

  return {
    subject,
    body: finalBody,
    isReady: true,
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
    } else if (templateData.channel === "email" && templateData.components) {
      enriched = extractEmailEnrichedFields(templateData.components);
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
 * Update an existing template
 * @param tenantDb
 * @param whatsappToken
 * @param businessAccountId
 * @param templateId - Could be name or ObjectId
 * @param templateData
 * @returns
 */
export const updateTemplate = async (
  tenantDb: Connection,
  whatsappToken: string | null,
  businessAccountId: string | null,
  templateId: string,
  templateData: any,
) => {
  try {
    const Template = getTenantModel<ITemplate>(
      tenantDb,
      "Template",
      schemas.templates,
    );

    // Try finding by ID first, then by name
    let query: any = { name: templateId };
    if (templateId.match(/^[0-9a-fA-F]{24}$/)) {
      query = {
        $or: [{ _id: templateId }, { name: templateId }],
      };
    }

    const existing = await Template.findOne(query);
    if (!existing) {
      throw new TemplateNotFoundError(templateId);
    }

    // For WhatsApp templates, we may need to handle Meta updates
    // NOTE: Meta restricts updates to APPROVED templates.
    // Usually, you delete and recreate or submit a new version.
    // For now, we'll focus on updating local fields which is what the user needs for email.

    let enriched = {};
    if (templateData.channel === "whatsapp" && templateData.components) {
      enriched = extractEnrichedFields(templateData.components);
    } else if (templateData.channel === "email" && templateData.components) {
      enriched = extractEmailEnrichedFields(templateData.components);
    }

    // Preserve important immutable fields if accidentally sent
    const updatePayload = {
      ...templateData,
      ...enriched,
      channel: existing.channel, // Channel cannot be changed on update
    };

    // Remove ID fields from payload to avoid Mongoose errors
    delete updatePayload._id;
    delete updatePayload.id;

    const updated = await Template.findOneAndUpdate(
      { _id: existing._id },
      { $set: updatePayload },
      { new: true },
    );

    return { success: true, data: updated };
  } catch (err: any) {
    console.error("Update Template Error:", err.message);
    throw err;
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

/**
 * Delete a template from local DB and Meta (if WhatsApp)
 */
export const deleteTemplate = async (
  tenantDb: Connection,
  whatsappToken: string | null,
  businessAccountId: string | null,
  templateName: string,
  clientCode: string,
) => {
  const Template = getTenantModel<ITemplate>(
    tenantDb,
    "Template",
    schemas.templates,
  );

  const template = await Template.findOne({ name: templateName });
  if (!template) throw new TemplateNotFoundError(templateName);

  if (template.channel === "whatsapp") {
    if (!whatsappToken || !businessAccountId) {
      throw new Error(
        "WhatsApp credentials not found. Cannot delete from Meta.",
      );
    }

    // If we have no templateId, it's likely local only (or hasn't been synced/created in Meta successfully)
    if (!template.templateId) {
      console.log(
        `[Delete] Template "${templateName}" has no templateId, skipping Meta deletion.`,
      );
    } else {
      try {
        console.log(
          `Deleting WhatsApp template from Meta: "${templateName}" (${template.language})`,
        );
        const metaParams: any = { name: templateName };
        if (template.language) metaParams.language = template.language;

        await axios.delete(
          `${WHATSAPP_API_URL}/${businessAccountId}/message_templates`,
          {
            params: metaParams,
            headers: { Authorization: `Bearer ${whatsappToken}` },
          },
        );
      } catch (err: any) {
        const respData = err.response?.data;
        const metaError = respData?.error?.message || respData || err.message;
        const subcode = respData?.error?.error_subcode;

        console.error(
          "Meta Template Deletion Error Details:",
          JSON.stringify(respData || err.message),
        );

        // If template is already deleted in Meta (404/subcode 2593002), we should still proceed with local deletion
        const isNotFound = err.response?.status === 404 || subcode === 2593002;

        if (!isNotFound) {
          throw new Error(`Meta: ${metaError}`);
        }

        console.log(
          `[Delete] Template "${templateName}" not found in Meta, proceeding with local deletion.`,
        );
      }
    }
  }

  // Cleanup ClientServiceConfig references
  try {
    const config = await ClientServiceConfig.findOne({ clientCode });
    if (config?.cron?.reminders?.timingRules) {
      const originalLength = config.cron.reminders.timingRules.length;
      config.cron.reminders.timingRules =
        config.cron.reminders.timingRules.filter(
          (rule) =>
            rule.whatsappTemplateName !== templateName &&
            rule.emailTemplateId !== templateName &&
            rule.emailTemplateId !== String(template._id),
        );

      if (config.cron.reminders.timingRules.length !== originalLength) {
        console.log(
          `[Cleanup] Removed template references from ClientConfig for ${clientCode}`,
        );
        await config.save();
      }
    }
  } catch (err) {
    console.warn(
      `[Cleanup] Failed to cleanup ClientConfig for ${clientCode}:`,
      err,
    );
  }

  await Template.deleteOne({ _id: template._id });
  return { success: true };
};

/**
 * Check if a template is referenced in any automation rules (actions or sequence steps).
 * Returns the list of rules that reference it so the caller can warn the user.
 */
export const checkTemplateUsageInAutomations = async (
  tenantDb: Connection,
  templateName: string,
): Promise<{ usedIn: { ruleId: string; ruleName: string }[] }> => {
  const AutomationRule = getTenantModel<IAutomationRule>(
    tenantDb,
    "AutomationRule",
    schemas.automationRules,
  );

  // Match rules where any action OR any sequence step references this template
  const rules = await AutomationRule.find({
    $or: [
      { "actions.config.templateName": templateName },
      { "steps.action.config.templateName": templateName },
    ],
  }).select("_id name");

  return {
    usedIn: rules.map((r: any) => ({
      ruleId: r._id.toString(),
      ruleName: r.name,
    })),
  };
};

/**
 * Remove all references to a template from automation rules.
 * Pulls matching actions from `actions[]` and matching steps from `steps[]`.
 */
export const removeTemplateFromAutomations = async (
  tenantDb: Connection,
  templateName: string,
): Promise<{ modifiedCount: number }> => {
  const AutomationRule = getTenantModel<IAutomationRule>(
    tenantDb,
    "AutomationRule",
    schemas.automationRules,
  );

  // Pull actions whose config.templateName matches
  const actionResult = await AutomationRule.updateMany(
    { "actions.config.templateName": templateName },
    { $pull: { actions: { "config.templateName": templateName } } as any },
  );

  // Pull sequence steps whose action.config.templateName matches
  const stepResult = await AutomationRule.updateMany(
    { "steps.action.config.templateName": templateName },
    { $pull: { steps: { "action.config.templateName": templateName } } as any },
  );

  return {
    modifiedCount: actionResult.modifiedCount + stepResult.modifiedCount,
  };
};
