import { logger } from "@/lib/logger";
import { getCrmModels } from "@lib/tenant/crm.models";

export class ActionExecutor {
  /**
   * Executes a specific automation action for a lead.
   *
   * @param clientCode Tenant client code
   * @param action Action definition { type, config }
   * @param context Data context for template resolution
   * @param io Socket.io instance for real-time updates (optional)
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
          return await this.sendWhatsApp(clientCode, config, context, io);

        case "send_email":
          return await this.sendEmail(clientCode, config, context);

        case "generate_meet":
        case "create_meeting":
          return await this.generateMeet(clientCode, config, context);

        case "update_lead":
          return await this.updateLead(clientCode, config, context);

        case "add_tag":
        case "tag_lead":
          return await this.updateTags(
            clientCode,
            context.lead._id,
            [config.tag || config.tagName],
            [],
          );

        case "remove_tag":
          return await this.updateTags(
            clientCode,
            context.lead._id,
            [],
            [config.tag || config.tagName],
          );

        case "move_stage":
        case "move_pipeline_stage":
          return await this.moveLead(
            clientCode,
            context.lead._id,
            config.stageId,
          );

        case "callback_client":
        case "webhook_notify":
        case "http_webhook":
          return await this.executeWebhook(clientCode, config, context);

        case "generate_ai_summary":
          return await this.generateAiSummary(clientCode, context);

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

  private static async sendWhatsApp(
    clientCode: string,
    config: any,
    context: any,
    io?: any,
  ) {
    const { resolveUnifiedWhatsAppTemplate } =
      await import("../whatsapp/template.service.ts");
    const { createWhatsappService } =
      await import("../whatsapp/whatsapp.service.ts");
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

  private static async sendEmail(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { createEmailService } = await import("../mail/email.service.ts");
    const svc = createEmailService();

    const subject = this.resolveTemplate(config.subject || "", context);
    const html = this.resolveTemplate(
      config.htmlBody || config.body || "",
      context,
    );

    return await svc.sendEmail(clientCode, {
      to: context.lead.email,
      subject,
      html,
    });
  }

  private static async generateMeet(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { createGoogleMeetService } =
      await import("../meet/google.meet.service.ts");
    const svc = createGoogleMeetService();

    const summary = this.resolveTemplate(config.summary || "Meeting", context);
    const res = await svc.createMeeting(clientCode, {
      summary,
      attendees: context.lead.email ? [context.lead.email] : [],
    });

    if (!res.success) throw new Error(res.error || "Failed to create meeting");
    return { meetLink: res.hangoutLink, eventId: res.eventId };
  }

  private static async updateLead(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const { Lead } = await getCrmModels(clientCode);
    const fields =
      typeof config.fields === "string"
        ? JSON.parse(this.resolveTemplate(config.fields, context))
        : config.fields || {};

    return await Lead.findByIdAndUpdate(
      context.lead._id,
      { $set: fields },
      { returnDocument: "after" },
    ).lean();
  }

  private static async updateTags(
    clientCode: string,
    leadId: string,
    add: string[],
    remove: string[],
  ) {
    const { updateTags } = await import("../crm/lead.service.ts");
    return await updateTags(clientCode, leadId.toString(), add, remove);
  }

  private static async moveLead(
    clientCode: string,
    leadId: string,
    stageId: string,
  ) {
    const { moveLead } = await import("../crm/lead.service.ts");
    return await moveLead(clientCode, leadId.toString(), stageId, "automation");
  }

  private static async executeWebhook(
    clientCode: string,
    config: any,
    context: any,
  ) {
    const url = this.resolveTemplate(config.url || "", context);
    const method = config.method || "POST";
    const body =
      typeof config.payload === "string"
        ? JSON.parse(this.resolveTemplate(config.payload, context))
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

  private static async generateAiSummary(clientCode: string, context: any) {
    const { generateConversationSummary } = await import("../ai/ai.service.ts");
    const { updateAiSummary } = await import("../crm/lead.service.ts");

    const leadId = context.lead._id.toString();
    const summary = await generateConversationSummary(clientCode, leadId);

    return await updateAiSummary(clientCode, leadId, summary);
  }

  public static resolveTemplate(template: any, context: any): any {
    if (typeof template === "object" && template !== null) {
      return JSON.parse(
        JSON.stringify(template).replace(/\{\{([^}]+)\}\}/g, (match, path) => {
          const value = path
            .trim()
            .split(".")
            .reduce(
              (o: any, i: string) =>
                o && typeof o === "object" ? o[i] : undefined,
              context,
            );
          return value !== undefined ? String(value) : match;
        }),
      );
    }
    if (typeof template !== "string") return template;
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = path
        .trim()
        .split(".")
        .reduce(
          (o: any, i: string) =>
            o && typeof o === "object" ? o[i] : undefined,
          context,
        );
      return value !== undefined ? String(value) : match;
    });
  }
}
