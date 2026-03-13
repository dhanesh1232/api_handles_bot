import { getCrmModels } from "@lib/tenant/get.crm.model";
import { logger } from "@lib/logger";
import { normalizePhone } from "@utils/phone";

let globalIo: any = null;

/**
 * Helper to register io instance globally for the processor
 */
export const registerGlobalIo = (io: any) => {
  globalIo = io;
};

/**
 * Standalone executor for both instant and scheduled workflows
 */
export const executeWorkflow = async (data: any) => {
  const {
    clientCode,
    phone,
    templateName,
    variables,
    channel,
    conversationId,
    callbackUrl,
    callbackMetadata,
  } = data;

  const { createWhatsappService } =
    await import("@services/saas/whatsapp/whatsapp.service");
  const whatsappService = createWhatsappService(globalIo);

  try {
    if (channel === "whatsapp") {
      let targetConversationId = conversationId;
      const normalizedPhone = normalizePhone(phone);

      if (!targetConversationId) {
        const { Conversation, conn: tenantConn } =
          await getCrmModels(clientCode);

        let conv = await Conversation.findOne({ phone: normalizedPhone });
        if (!conv) {
          conv = await Conversation.create({
            phone: normalizedPhone,
            userName: normalizedPhone,
            status: "open",
            channel: "whatsapp",
          });
        }
        targetConversationId = conv._id;
      }

      let finalVariables = variables || [];
      let templateLanguage = "en_US";

      // New way: Resolve variables from context
      if (templateName && data.context) {
        try {
          const { conn: tenantConn } = await getCrmModels(clientCode);

          const { resolveUnifiedWhatsAppTemplate } =
            await import("@services/saas/whatsapp/template.service");

          const resolution = await resolveUnifiedWhatsAppTemplate(
            tenantConn,
            templateName,
            data.context.lead || {},
            data.context.vars || data.context.event || data.context,
          );

          finalVariables = resolution.resolvedVariables;
          templateLanguage = resolution.languageCode;

          logger.debug(
            { clientCode, templateName, resolvedCount: finalVariables.length },
            "[WorkflowExecutor] Resolved template variables",
          );
        } catch (err: any) {
          logger.warn(
            { clientCode, templateName, err },
            "[WorkflowExecutor] Variable resolution failed",
          );

          // Legacy fallback: if variables array is also present, use it
          if (variables && variables.length > 0) {
            logger.warn(
              { templateName },
              "[WorkflowExecutor] Falling back to static variables",
            );
            finalVariables = variables;
          } else {
            // Handle specific error types if needed or just rethrow
            throw err;
          }
        }
      } else if (variables && variables.length > 0) {
        logger.debug(
          { templateName },
          "[WorkflowExecutor] Using static variables (deprecated)",
        );
      }

      await whatsappService.sendOutboundMessage(
        clientCode,
        targetConversationId,
        undefined, // text
        undefined, // mediaUrl
        undefined, // mediaType
        "system-worker", // userId
        templateName,
        templateLanguage,
        finalVariables,
      );

      // Handle Callback if provided
      if (callbackUrl) {
        logger.info(
          { clientCode, callbackUrl },
          "[Callback] Triggering callback",
        );
        const { sendCallbackWithRetry } = await import("@lib/callbackSender");
        void sendCallbackWithRetry({
          clientCode,
          callbackUrl,
          payload: {
            status: "sent",
            metadata: callbackMetadata,
            sentAt: new Date(),
          },
        });
      }
    } else {
      throw new Error(
        `Unsupported or missing channel: "${channel}". Job data must include channel: "whatsapp".`,
      );
    }
  } catch (err: any) {
    logger.error({ err }, "[WorkflowExecutor] Execution failed");
    throw err;
  }
};
