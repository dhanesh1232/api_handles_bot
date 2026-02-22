import { getTenantConnection, getTenantModel } from "../../lib/connectionManager.js";
import { schemas } from "../../model/saas/tenantSchemas.js";

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
    callbackMetadata
  } = data;
  
  const { createWhatsappService } = await import("../../services/saas/whatsapp/whatsappService.ts");
  const whatsappService = createWhatsappService(globalIo);

  try {
    if (channel === "whatsapp") {
       let targetConversationId = conversationId;

       if (!targetConversationId) {
           const tenantConn = await getTenantConnection(clientCode);
           const Conversation = getTenantModel(tenantConn, "Conversation", schemas.conversations);
           
           let conv = await Conversation.findOne({ phone });
           if (!conv) {
               conv = await Conversation.create({
                   phone,
                   userName: phone,
                   status: "open",
                   channel: "whatsapp"
               });
           }
           targetConversationId = conv._id;
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
           variables || []
       );
       
       // Handle Callback if provided
       if (callbackUrl) {
           console.log(`[Callback] Triggering callback to ${callbackUrl}`);
           try {
               await fetch(callbackUrl, {
                   method: "PUT",
                   headers: {
                       "Content-Type": "application/json"
                   },
                   body: JSON.stringify({
                       status: "delivered",
                       metadata: callbackMetadata,
                       sentAt: new Date()
                   })
               });
           } catch (cbErr: any) {
               console.error(`[Callback] Failed to notify client:`, cbErr.message);
           }
       }
    }
  } catch (err: any) {
    console.error(`[Processor Logic] Execution failed:`, err.message);
    throw err;
  }
};
