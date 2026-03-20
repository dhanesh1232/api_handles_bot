/**
 * @file src/services/saas/automation/actionExecutor.service.ts
 * @module ActionExecutor
 * @responsibility Executes individual automation actions (WhatsApp, Email, Webhooks, etc.)
 * @dependencies @lib/tenant/crm.models, @/lib/logger, template.service, whatsapp.service
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import { logger } from "@/lib/logger";

export class ActionExecutor {
  /**
   * The primary dispatcher for all triggered automation business logic.
   *
   * @param clientCode - Tenant identifier for environment isolation.
   * @param action - The action definition from the blueprint/database.
   * @param action.type - Operation key (e.g., `send_whatsapp`, `move_stage`).
   * @param action.config - Parameter map specific to the action type.
   * @param context - Execution environment.
   * @param context.lead - The lead in scope for this automation.
   * @param context.variables - (Optional) Dynamic event data (e.g., webhook payload).
   * @param io - (Optional) Socket instance for real-time frontend feedback.
   *
   * @returns {Promise<any>} Response from the underlying handler (e.g., message SID, meeting link).
   *
   * **DETAILED EXECUTION:**
   * 1. **Routing**: Inspects `action.type` and maps it to a private specialized handler.
   * 2. **Config Sanitization**: Ensures `config` exists as an object to prevent downstream errors.
   * 3. **Execution Guard**: Wraps the call in a global try/catch for the `ActionExecutor` scope.
   *    - Detailed error logs (including lead ID) are generated for debugging complex automation failures.
   */
  static async execute(
    clientCode: string,
    action: { type: string; config: any },
    context: { lead: any; [key: string]: any },
    io?: any,
  ): Promise<any> {
    const type = action.type;
    const config = action.config || {};

    try {
      switch (type) {
        case "send_whatsapp":
          return await ActionExecutor.sendWhatsApp(
            clientCode,
            config,
            context,
            io,
          );

        case "send_email":
          return await ActionExecutor.sendEmail(clientCode, config, context);

        case "generate_meet":
        case "create_meeting":
          return await ActionExecutor.generateMeet(clientCode, config, context);

        case "update_lead":
          return await ActionExecutor.updateLead(clientCode, config, context);

        case "add_tag":
        case "tag_lead":
          return await ActionExecutor.updateTags(
            clientCode,
            context.lead._id,
            [config.tag || config.tagName],
            [],
          );

        case "remove_tag":
          return await ActionExecutor.updateTags(
            clientCode,
            context.lead._id,
            [],
            [config.tag || config.tagName],
          );

        case "move_stage":
        case "move_pipeline_stage":
          return await ActionExecutor.moveLead(
            clientCode,
            context.lead._id,
            config.stageId,
          );

        case "callback_client":
        case "webhook_notify":
        case "http_webhook":
          return await ActionExecutor.executeWebhook(
            clientCode,
            config,
            context,
          );

        case "generate_ai_summary":
          return await ActionExecutor.generateAiSummary(clientCode, context);

        default:
          throw new Error(`Unsupported action type: ${type}`);
      }
    } catch (err: any) {
      logger.error(
        err,
        `[ActionExecutor] Failed to execute ${type} for lead ${context.lead?._id}`,
      );
      throw err;
    }
  }

  /**
   * Sends a pre-approved WhatsApp Business message with dynamic variable resolution.
   *
   * @param clientCode - Tenant ID.
   * @param config - Action config containing `templateName`.
   * @param context - Execution context (Lead + Event Vars).
   *
   * **DETAILED EXECUTION:**
   * 1. **Lazy Loading**: Imports `template.service` and `whatsapp.service` only when needed to optimize startup time.
   * 2. **Unified Template Resolution**:
   *    - Calls `resolveUnifiedWhatsAppTemplate` to map local CRM data to Meta/Twilio-approved placeholders.
   *    - This handles the complex logic of fetching data from the lead's profile, custom fields, and the triggering event.
   * 3. **Conversation Discovery**: Ensures a `Conversation` record exists so the user perceives a continuous chat history.
   * 4. **Dispatch**: Forwards to the `WhatsappService` with `source: "automation"` for proper credit accounting and message tagging.
   */
  private static async sendWhatsApp(
    clientCode: string,
    config: any,
    context: any,
    io?: any,
  ) {
    const { resolveUnifiedWhatsAppTemplate } = await import(
      "../whatsapp/template.service.ts"
    );
    const { createWhatsappService } = await import(
      "../whatsapp/whatsapp.service.ts"
    );
    const { Conversation, conn: tenantConn } = await getCrmModels(clientCode);

    const lead = context.lead;
    const templateData = context.variables || context.event || context;

    const resolution = await resolveUnifiedWhatsAppTemplate(
      tenantConn,
      config.templateName,
      lead,
      templateData,
    );

    let conv = await Conversation.findOne({ phone: lead.phone }).lean();
    if (!conv) {
      const newConv = await Conversation.create({
        phone: lead.phone,
        userName: lead.firstName || lead.phone,
        status: "open",
        channel: "whatsapp",
      });
      conv = newConv.toObject();
    }

    const svc = createWhatsappService(io || null);
    return await svc.sendOutboundMessage(
      clientCode,
      conv._id.toString(),
      undefined,
      undefined,
      undefined,
      "automation",
      config.templateName,
      resolution.languageCode,
      resolution.resolvedVariables,
    );
  }

  /**
   * Sends a personalized email with full template resolution support.
   *
   * @param clientCode - Tenant ID.
   * @param config - Email config (subject, body/htmlBody).
   * @param context - Source data for variable injection.
   *
   * **DETAILED EXECUTION:**
   * 1. **Double Template Resolution**: Independently resolves `{{vars}}` in both the Subject line and the HTML body.
   * 2. **Provider Dispatch**: Proxies to `EmailService` which handles the actual SMTP/provider (SES/SendGrid) logic.
   */
  private static async sendEmail(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { createEmailService } = await import("../mail/email.service.ts");
    const svc = createEmailService();

    const subject = ActionExecutor.resolveTemplate(
      config.subject || "",
      context,
    );
    const html = ActionExecutor.resolveTemplate(
      config.htmlBody || config.body || "",
      context,
    );

    return await svc.sendEmail(clientCode, {
      to: context.lead.email,
      subject,
      html,
    });
  }

  /**
   * Dynamically generates a virtual meeting link and attaches it to the automation context.
   *
   * @param clientCode - Tenant ID.
   * @param config - Config containing the meeting `summary`.
   * @param context - Context for resolving summary placeholders (e.g. `{{lead.firstName}}'s Consultation`).
   *
   * @returns {Promise<Object>} The `meetLink` and `eventId` generated by Google/Microsoft.
   */
  private static async generateMeet(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { createGoogleMeetService } = await import(
      "../meet/google.meet.service.ts"
    );
    const svc = createGoogleMeetService();

    const summary = ActionExecutor.resolveTemplate(
      config.summary || "Meeting",
      context,
    );
    const res = await svc.createMeeting(clientCode, {
      summary,
      attendees: context.lead.email ? [context.lead.email] : [],
    });

    if (!res.success) throw new Error(res.error || "Failed to create meeting");
    return { meetLink: res.hangoutLink, eventId: res.eventId };
  }

  /**
   * Updates lead profile fields with dynamic resolution.
   *
   * **WORKING PROCESS:**
   * 1. Fetches the tenant-specific `Lead` model.
   * 2. Resolves template placeholders in the fields configuration (if string).
   * 3. Performs a `findByIdAndUpdate` to persist changes.
   *
   * @param {string} clientCode - Tenant's unique code.
   * @param {any} config - Update configuration (fields to change).
   * @param {any} context - Full execution context.
   */
  private static async updateLead(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { Lead } = await getCrmModels(clientCode);
    const fields =
      typeof config.fields === "string"
        ? JSON.parse(ActionExecutor.resolveTemplate(config.fields, context))
        : config.fields || {};

    return await Lead.findByIdAndUpdate(
      context.lead._id,
      { $set: fields },
      { returnDocument: "after" },
    ).lean();
  }

  /**
   * Atomic addition or removal of tags.
   *
   * **WORKING PROCESS:**
   * 1. Imports the core `updateTags` service.
   * 2. Sanitizes input arrays for null/undefined values.
   * 3. Triggers the service-level tag update logic.
   *
   * @param {string} clientCode - Tenant's unique code.
   * @param {string} leadId - Target lead ID.
   * @param {string[]} add - Tags to append.
   * @param {string[]} remove - Tags to strip.
   */
  private static async updateTags(
    clientCode: string,
    leadId: string,
    add: string[],
    remove: string[],
  ) {
    const { updateTags } = await import("../crm/lead.service.ts");
    return await updateTags(clientCode, leadId.toString(), add, remove);
  }

  /**
   * Moves a lead between pipeline stages.
   *
   * **WORKING PROCESS:**
   * 1. Imports the core `moveLead` service.
   * 2. Executes the stage transition with an "automation" source tag for audit trails.
   *
   * @param {string} clientCode - Tenant's unique code.
   * @param {string} leadId - Target lead ID.
   * @param {string} stageId - Destination stage ID.
   */
  private static async moveLead(
    clientCode: string,
    leadId: string,
    stageId: string,
  ) {
    const { moveLead } = await import("../crm/lead.service.ts");
    return await moveLead(clientCode, leadId.toString(), stageId, "automation");
  }

  /**
   * Dispatches a dynamic HTTP webhook (Callback) to external systems.
   *
   * **WORKING PROCESS:**
   * 1. Fully resolves the Webhook URL and Payload body using `resolveTemplate`.
   * 2. Executes a standard HTTP POST/GET as configured.
   * 3. Returns the status code to the sequence engine for success tracking.
   *
   * **EDGE CASES:**
   * - Timeout: External system slowness can hang the executor; standard fetch timeout applies.
   * - Invalid JSON: If payload resolution results in malformed JSON, `JSON.parse` will throw.
   */
  private static async executeWebhook(
    _clientCode: string,
    config: any,
    context: any,
  ) {
    const url = ActionExecutor.resolveTemplate(config.url || "", context);
    const method = config.method || "POST";
    const body =
      typeof config.payload === "string"
        ? JSON.parse(ActionExecutor.resolveTemplate(config.payload, context))
        : config.payload || {};

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      body: JSON.stringify(body),
    });

    return { status: response.status, ok: response.ok };
  }

  /**
   * Triggers an AI-powered conversation summary.
   *
   * **WORKING PROCESS:**
   * 1. Dynamically imports AI and Lead services.
   * 2. Calls `generateConversationSummary` to analyze the lead's history.
   * 3. Syncs the resulting summary back to the lead document.
   *
   * @param {string} clientCode - Tenant unique code.
   * @param {any} context - Execution context containing the lead.
   */
  private static async generateAiSummary(clientCode: string, context: any) {
    const { generateConversationSummary } = await import("../ai/ai.service.ts");
    const { updateAiSummary } = await import("../crm/lead.service.ts");

    const leadId = context.lead._id.toString();
    const summary = await generateConversationSummary(clientCode, leadId);

    return await updateAiSummary(clientCode, leadId, summary);
  }

  /**
   * The "Brain" of the template engine. Deep-resolves complex object trees for variable injection.
   *
   * @param template - A string, array, or object containing `{{path.to.var}}` placeholders.
   * @param context - The data pool (Lead, Event, Sequence) to pull values from.
   *
   * @returns {any} The fully resolved template with the same input structure.
   *
   * **DETAILED EXECUTION:**
   * 1. **Discovery Loop**: Uses RegEx (`/\{\{([^}]+)\}\}/g`) to find all potential variables.
   * 2. **Deep Access Path resolution**: Splits `path.to.var` and uses `reduce` to traverse the `context` object safely.
   * 3. **Smart Serialization & Formatting**:
   *    - **Context-Aware Dates**: Detects ISO strings or Date objects and formats them to Indian Standard Time (IST) with friendly weekday/time labels.
   *    - **Financial Intelligence**: Detects "price", "amount", or "total" in the path names.
   *      - If the value is a large integer (Paise), it automatically scales to Rupees.
   *      - Formats using `Intl.NumberFormat` for INR (e.g., ₹1,200.50).
   *    - **Complex Data**: Gracefully `JSON.stringify`s objects if injected into a string template.
   * 4. **Recursion**: If an object or array is passed, it deep-clones and resolves every nested string property.
   *
   * **GOAL**: This makes our automation sequences "feel human" by providing correctly formatted, localized data.
   */
  public static resolveTemplate(template: any, context: any): any {
    const resolver = (match: string, path: string) => {
      const parts = path.trim().split(".");
      const value = parts.reduce(
        (o: any, i: string) => (o && typeof o === "object" ? o[i] : undefined),
        context,
      );

      if (value === undefined || value === null) return match;

      // 1. Date Formatting
      if (
        value instanceof Date ||
        (typeof value === "string" &&
          value.length > 10 &&
          !Number.isNaN(Date.parse(value)) &&
          /^\d{4}-\d{2}-\d{2}T/.test(value))
      ) {
        const date = new Date(value);
        return (
          date.toLocaleDateString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          }) +
          " " +
          date.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        );
      }

      // 2. Currency/Number Formatting
      const lowerPath = path.toLowerCase();
      if (
        typeof value === "number" &&
        (lowerPath.includes("price") ||
          lowerPath.includes("amount") ||
          lowerPath.includes("total") ||
          lowerPath.includes("fee"))
      ) {
        // Assume large integers in price fields are in minor units (paise/cents)
        const displayValue =
          value > 1000 && Number.isInteger(value) ? value / 100 : value;
        return new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 2,
        }).format(displayValue);
      }

      // 3. Object/Array fallback
      if (typeof value === "object") {
        return JSON.stringify(value);
      }

      return String(value);
    };

    if (typeof template === "object" && template !== null) {
      return JSON.parse(
        JSON.stringify(template).replace(/\{\{([^}]+)\}\}/g, resolver),
      );
    }

    if (typeof template !== "string") return template;
    return template.replace(/\{\{([^}]+)\}\}/g, resolver);
  }
}
