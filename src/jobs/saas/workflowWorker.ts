import {
  getTenantConnection,
  getTenantModel,
} from "../../lib/connectionManager.ts";
import { schemas } from "../../model/saas/tenant.schemas.ts";

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
    await import("../../services/saas/whatsapp/whatsapp.service.ts");
  const whatsappService = createWhatsappService(globalIo);

  try {
    if (channel === "whatsapp") {
      let targetConversationId = conversationId;

      if (!targetConversationId) {
        const tenantConn = await getTenantConnection(clientCode);
        const Conversation = getTenantModel(
          tenantConn,
          "Conversation",
          schemas.conversations,
        );

        let conv = await Conversation.findOne({ phone });
        if (!conv) {
          conv = await Conversation.create({
            phone,
            userName: phone,
            status: "open",
            channel: "whatsapp",
          });
        }
        targetConversationId = conv._id;
      }

      let finalVariables = variables || [];

      // New way: Resolve variables from context
      if (templateName && data.context) {
        try {
          const tenantConn = await getTenantConnection(clientCode);
          const { resolveTemplateVariables } =
            await import("../../services/saas/whatsapp/template.service.ts");

          finalVariables = await resolveTemplateVariables(
            tenantConn,
            templateName,
            data.context,
          );

          console.log(
            `[WorkflowExecutor] Resolved variables for ${templateName}:`,
            finalVariables,
          );
        } catch (err: any) {
          console.error(
            `[WorkflowExecutor] Variable resolution failed:`,
            err.message,
          );

          // Legacy fallback: if variables array is also present, use it
          if (variables && variables.length > 0) {
            console.warn(
              `[WorkflowExecutor] Falling back to static variables for ${templateName}`,
            );
            finalVariables = variables;
          } else {
            // Handle specific error types if needed or just rethrow
            throw err;
          }
        }
      } else if (variables && variables.length > 0) {
        console.log(
          `[WorkflowExecutor] Using static variables (deprecated) for ${templateName}`,
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
        "en_US",
        finalVariables,
      );

      // Handle Callback if provided
      if (callbackUrl) {
        console.log(`[Callback] Triggering callback to ${callbackUrl}`);
        try {
          await fetch(callbackUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              status: "sent",
              metadata: callbackMetadata,
              sentAt: new Date(),
            }),
          });
        } catch (cbErr: any) {
          console.error(`[Callback] Failed to notify client:`, cbErr.message);
        }
      }
    } else {
      throw new Error(
        `Unsupported or missing channel: "${channel}". Job data must include channel: "whatsapp".`,
      );
    }
  } catch (err: any) {
    console.error(`[Processor Logic] Execution failed:`, err.message);
    throw err;
  }
};
