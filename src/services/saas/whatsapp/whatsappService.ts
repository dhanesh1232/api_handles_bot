import axios from "axios";
import FormData from "form-data";
import mongoose, { type Connection, type Model } from "mongoose";
import path from "path";
import { Server } from "socket.io";
import { dbConnect } from "../../../lib/config.js";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.js";
import { ClientSecrets } from "../../../model/clients/secrets.js";
import { schemas } from "../../../model/saas/tenantSchemas.js";
import type { IConversation } from "../../../model/saas/whatsapp/conversation.model.ts";
import type { IMessage, IMessageTemplateData } from "../../../model/saas/whatsapp/message.model.ts";
import type { ITemplate } from "../../../model/saas/whatsapp/template.model.ts";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

const STATUS_PRIORITY: Record<string, number> = {
  read: 10,
  delivered: 8,
  failed: 5,
  sent: 3,
  queued: 1,
};

interface WhatsAppServiceContext {
  secrets: any;
  Conversation: Model<IConversation>;
  Message: Model<IMessage>;
  Template: Model<ITemplate>;
  tenantConn: Connection;
}

/**
 * WhatsApp Service Factory
 * @param {Server} io - Socket.io instance
 */
export const createWhatsappService = (io: Server) => {
  /**
   * Helper to get tenant context: Connection, Models, Secrets
   */
  const getContext = async (clientCode: string): Promise<WhatsAppServiceContext> => {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    const tenantConn = await getTenantConnection(clientCode);
    const Conversation = getTenantModel<IConversation>(
      tenantConn,
      "Conversation",
      schemas.conversations,
    );
    const Message = getTenantModel<IMessage>(tenantConn, "Message", schemas.messages);
    const Template = getTenantModel<ITemplate>(tenantConn, "Template", schemas.templates);

    return { secrets, Conversation, Message, Template, tenantConn };
  };

  /**
   * Download Media from WhatsApp and Upload to R2 (via mediaService)
   */
  const processIncomingMedia = async (mediaId: string, secrets: any, originalFilename?: string): Promise<string | null> => {
    if (!mediaId) return null;
    try {
      const token = secrets.getDecrypted("whatsappToken");
      // 1. Get URL
      const urlRes = await axios.get(`${WHATSAPP_API_URL}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const mediaUrl = urlRes.data.url;
      const mimeType = urlRes.data.mime_type;

      // 2. Download Buffer
      const response = await axios({
        url: mediaUrl,
        method: "GET",
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${token}` },
      });

      // 3. Optimize & Upload
      const { optimizeAndUploadMedia } = await import("../mediaService.js");

      const result = await optimizeAndUploadMedia(
        response.data,
        mimeType,
        originalFilename,
        mediaId,
        secrets,
      );

      return result.url;
    } catch (e: any) {
      console.error("Media processing failed:", e.message);
      return null;
    }
  };

  // --- Core Methods ---

  const handleIncomingMessage = async (
    clientCode: string,
    messagePayload: any,
    from: string,
    msgBody: string,
    contacts: any,
  ) => {
    try {
      console.log(`[${clientCode}] Handling Incoming Message from: ${from}`);
      const { secrets, Conversation, Message } = await getContext(clientCode);

      const phone = from;
      const userName = contacts?.profile?.name || "Customer";
      const profilePicture = contacts?.profile?.profile_picture; 

      // 1. Find or Create Conversation
      let conversation = await Conversation.findOne({ phone });
      if (!conversation) {
        conversation = await Conversation.create({
          phone,
          userName: userName !== "Customer" ? userName : phone,
          profilePicture: profilePicture,
          status: "open",
          channel: "whatsapp",
          unreadCount: 0,
        });
        console.log(
          `[${clientCode}] New Conversation Created: ${conversation._id}`,
        );
      } else {
        // Update name if currently a placeholder (phone or "Customer") or different
        const isPlaceholder =
          conversation.userName === "Customer" ||
          conversation.userName === conversation.phone ||
          !conversation.userName;

        if (
          userName !== "Customer" &&
          (conversation.userName !== userName || isPlaceholder)
        ) {
          conversation.userName = userName;
        }
        if (profilePicture && conversation.profilePicture !== profilePicture) {
          conversation.profilePicture = profilePicture;
        }
        if (conversation.isModified()) {
          await conversation.save();
        }
      }

      // Check duplicate message
      const exists = await Message.findOne({
        whatsappMessageId: messagePayload.id,
      });
      if (exists) {
        console.log(
          `[${clientCode}] Duplicate Message Ignored: ${messagePayload.id}`,
        );
        return;
      }

      let mediaUrl: string | null = null;
      let messageType = messagePayload.type || "text";
      let finalMsgBody = msgBody;

      if (messageType === "interactive") {
        const iType = messagePayload.interactive?.type;
        if (iType === "button_reply") {
          finalMsgBody = messagePayload.interactive.button_reply?.title;
        } else if (iType === "list_reply") {
          finalMsgBody = messagePayload.interactive.list_reply?.title;
        }
      } else if (messageType === "image") {
        mediaUrl = await processIncomingMedia(
          messagePayload.image?.id,
          secrets,
        );
        finalMsgBody = messagePayload.image?.caption || "";
      } else if (messageType === "document") {
        mediaUrl = await processIncomingMedia(
          messagePayload.document?.id,
          secrets,
          messagePayload.document?.filename,
        );
        finalMsgBody =
          messagePayload.document?.caption ||
          messagePayload.document?.filename ||
          "Document";
      } else if (messageType === "video") {
        mediaUrl = await processIncomingMedia(
          messagePayload.video?.id,
          secrets,
        );
        finalMsgBody = messagePayload.video?.caption || "";
      } else if (messageType === "audio") {
        mediaUrl = await processIncomingMedia(
          messagePayload.audio?.id,
          secrets,
        );
      } else if (messageType === "reaction") {
        // Handle Incoming Reaction
        const reactedToId = messagePayload.reaction?.message_id;
        const emoji = messagePayload.reaction?.emoji || "";

        if (reactedToId) {
          const originalMsg = await Message.findOne({
            whatsappMessageId: reactedToId,
          });
          if (originalMsg) {
            if (!Array.isArray(originalMsg.reactions)) {
              originalMsg.reactions = [];
            }

            const senderReactionIndex = originalMsg.reactions.findIndex(
              (r: any) => r.reactBy === from,
            );

            if (!emoji) {
              // Remove reaction
              if (senderReactionIndex !== -1) {
                originalMsg.reactions.splice(senderReactionIndex, 1);
              }
            } else {
              // Update or Add
              if (senderReactionIndex !== -1) {
                originalMsg.reactions[senderReactionIndex].emoji = emoji;
              } else {
                originalMsg.reactions.push({ emoji, reactBy: from });
              }
            }

            await originalMsg.save();

            // Emit update
            if (io) {
              io.to(clientCode).emit("message_updated", {
                messageId: originalMsg._id,
                conversationId: originalMsg.conversationId,
                updates: { reactions: originalMsg.reactions },
              });
            }
          }
        }
        return; 
      }

      // 2.5 Find Replied Message if any
      let replyTo: mongoose.Types.ObjectId | null = null;
      let replyToWhatsappId: string | null = null;
      if (messagePayload.context?.id) {
        replyToWhatsappId = messagePayload.context.id;
        const repliedMsg = await Message.findOne({
          whatsappMessageId: replyToWhatsappId,
        });
        if (repliedMsg) {
          replyTo = repliedMsg._id as mongoose.Types.ObjectId;
        }
      }

      // 3. Save Message if it has content or is a recognized type
      if (!finalMsgBody && !mediaUrl && messageType === "text") {
        console.log(
          `[${clientCode}] Skipping empty inbound message from ${from}`,
        );
        return;
      }

      try {
        const newMessage = await Message.create({
          conversationId: conversation._id,
          direction: "inbound",
          messageType,
          text: finalMsgBody,
          mediaUrl,
          whatsappMessageId: messagePayload.id,
          replyTo,
          replyToWhatsappId,
          status: "delivered", 
        });
        console.log(
          `✅ [${clientCode}] Inbound Message saved: ${newMessage._id}`,
        );

        // 4. Update Conversation
        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: finalMsgBody,
              lastMessageAt: new Date(),
              lastMessageSender: "user",
              lastMessageType: messageType,
              lastUserMessageAt: new Date(),
              lastMessageId: newMessage._id,
              lastMessageStatus: "delivered",
            },
            $inc: { unreadCount: 1 },
          },
        );

        // 5. Emit Socket
        if (io) {
          // Update in-memory object for emit
          conversation.lastMessage = finalMsgBody;
          conversation.lastMessageAt = new Date();
          conversation.lastMessageSender = "user";
          conversation.lastMessageType = messageType;
          conversation.lastUserMessageAt = new Date();
          conversation.lastMessageId = newMessage._id as mongoose.Types.ObjectId;
          conversation.lastMessageStatus = "delivered";
          conversation.unreadCount = (conversation.unreadCount || 0) + 1;

          if (replyTo) {
            await newMessage.populate("replyTo");
          }

          const ioPayload = {
            ...conversation.toObject(),
            message: newMessage.toObject(),
            clientCode,
          };
          io.to(clientCode).emit("new_message", ioPayload);
          io.to(clientCode).emit(
            "conversation_updated",
            conversation.toObject(),
          );
        }
      } catch (saveError) {
        console.error(`❌ [${clientCode}] Failed to save message:`, saveError);
      }
    } catch (err) {
      console.error(`Error handling incoming message for ${clientCode}:`, err);
    }
  };

  const handleStatusUpdate = async (clientCode: string, statusPayload: any) => {
    try {
      const { Message, Conversation } = await getContext(clientCode);
      const { id, status, errors } = statusPayload;

      const message = await Message.findOne({ whatsappMessageId: id });
      if (!message) return;

      const currentPriority = STATUS_PRIORITY[message.status] || 0;
      const newPriority = STATUS_PRIORITY[status] || 0;
      if (newPriority > currentPriority) {
        message.status = status;

        // Clear errors if the message is now successful
        if (status === "delivered" || status === "read") {
          message.error = undefined;
        } else if (errors) {
          message.error = JSON.stringify(errors);
        }

        message.statusHistory.push({ status, timestamp: new Date() });
        await message.save();
      } else {
        if (status !== message.status) {
          console.log(
            `[${clientCode}] Status Update Ignored (Out of Order): Current: ${message.status}, Incoming: ${status} for ${id}`,
          );
        }
        return;
      }

      const conversation = await Conversation.findById(message.conversationId);
      if (
        conversation &&
        conversation.lastMessageId?.toString() === message._id.toString()
      ) {
        const lastStatus = (conversation.lastMessageStatus || "queued") as string;
        const convPriority = STATUS_PRIORITY[lastStatus] || 0;
        if (newPriority > convPriority) {
          conversation.lastMessageStatus = status as any;
          await conversation.save();
        }
      }

      // Emit
      if (io) {
        io.to(clientCode).emit("message_status_update", {
          messageId: message._id,
          conversationId: message.conversationId,
          status,
          statusHistory: message.statusHistory,
          whatsappMessageId: id,
        });

        // Also emit conversation update if it changed
        if (
          conversation &&
          conversation.lastMessageId?.toString() === message._id.toString()
        ) {
          io.to(clientCode).emit(
            "conversation_updated",
            conversation.toObject(),
          );
        }
      }
    } catch (err) {
      console.error("Error handling status update:", err);
    }
  };

  const sendOutboundMessage = async (
    clientCode: string,
    conversationId: string,
    text?: string,
    mediaUrl?: string,
    mediaType?: string,
    userId: string = "admin",
    templateName?: string,
    templateLanguage: string = "en_US",
    variables: string[] = [],
    replyToId: string | null = null,
  ) => {
    const { secrets, Conversation, Message, Template } =
      await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error("Conversation not found");

    let replyToWhatsappId: string | null = null;
    if (replyToId) {
      const parentMsg = await Message.findById(replyToId);
      if (parentMsg && parentMsg.whatsappMessageId) {
        replyToWhatsappId = parentMsg.whatsappMessageId;
      }
    }

    const to = conversation.phone;
    let finalMessageType: any = "text";
    let resolvedText = text;

    // Logic for Template / Media / Text
    let templateData: IMessageTemplateData | undefined = undefined;
    if (templateName) {
      finalMessageType = "template";
      const tmpl = await Template.findOne({
        name: templateName,
        language: templateLanguage,
      });
      if (tmpl) {
        let content = tmpl.bodyText;
        if (variables && variables.length > 0) {
          variables.forEach((val, idx) => {
            const regex = new RegExp(`\\{\\{${idx + 1}\\}\\}`, "g");
            content = content.replace(regex, val || "");
          });
        }
        resolvedText = content;
        templateData = {
          name: templateName,
          language: templateLanguage,
          footer: tmpl.footerText,
          buttons: tmpl.buttons,
          variables: variables, 
          headerType: tmpl.headerType,
        };
      } else {
        resolvedText = text || `Template: ${templateName}`;
      }
    } else if (mediaUrl) {
      finalMessageType = mediaType || "image";
    }

    // Save Queued Message
    const messageData: any = {
      conversationId: conversation._id,
      direction: "outbound",
      messageType: finalMessageType,
      text: resolvedText,
      mediaUrl,
      mediaType,
      caption: resolvedText,
      templateData,
      status: "queued",
      statusHistory: [{ status: "queued", timestamp: new Date() }],
    };
    if (userId && userId !== "system") {
      messageData.sentBy = userId;
    }
    if (replyToId) {
      messageData.replyTo = replyToId;
      messageData.replyToWhatsappId = replyToWhatsappId;
    }

    const message = await Message.create(messageData);
    console.log(`[${clientCode}] Outbound Message Queued: ${message._id}`);

    // Update Conversation head immediately
    const conv = await Conversation.findByIdAndUpdate(
      conversationId,
      {
        lastMessage: resolvedText,
        lastMessageAt: new Date(),
        lastMessageSender: "admin",
        lastMessageType: finalMessageType,
        lastMessageId: message._id,
        lastMessageStatus: "queued",
        unreadCount: 0,
      },
      { new: true },
    );

    if (io && conv) {
      io.to(clientCode).emit("conversation_updated", conv.toObject());
    }

    try {
      // 1. Upload Media
      let mediaId: string | null = null;
      if (
        mediaUrl &&
        (["image", "video", "audio", "document"].includes(finalMessageType) ||
          finalMessageType === "template")
      ) {
        const fileRes = await axios.get(mediaUrl, { responseType: "stream" });
        const form = new FormData();
        form.append("file", fileRes.data, {
          filename: path.basename(mediaUrl),
          contentType: fileRes.headers["content-type"],
        });
        form.append("messaging_product", "whatsapp");

        const uploadRes = await axios.post(
          `${WHATSAPP_API_URL}/${phoneId}/media`,
          form,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              ...form.getHeaders(),
            },
          },
        );
        mediaId = uploadRes.data.id;
      }

      // 2. Build Payload
      const payload: any = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: finalMessageType,
      };

      if (replyToWhatsappId) {
        payload.context = { message_id: replyToWhatsappId };
      }

      if (finalMessageType === "template") {
        const tmpl = await Template.findOne({
          name: templateName,
          language: templateLanguage,
        });

        payload.template = {
          name: templateName,
          language: { code: templateLanguage },
          components: [],
        };

        if (tmpl && tmpl.components) {
          let varIndex = 0;

          for (const comp of tmpl.components) {
            if (comp.type === "HEADER") {
              const headerParams: any[] = [];
              if (["IMAGE", "VIDEO", "DOCUMENT"].includes(comp.format)) {
                if (mediaId) {
                  headerParams.push({
                    type: comp.format,
                    [comp.format.toLowerCase()]: { id: mediaId },
                  });
                }
              }
              const headerVarsCount = (comp.text?.match(/{{[0-9]+}}/g) || [])
                .length;
              for (let i = 0; i < headerVarsCount; i++) {
                if (variables[varIndex] !== undefined) {
                  headerParams.push({
                    type: "text",
                    text: String(variables[varIndex++]),
                  });
                }
              }
              if (headerParams.length > 0) {
                payload.template.components.push({
                  type: "HEADER",
                  parameters: headerParams,
                });
              }
            } else if (comp.type === "BODY") {
              const bodyVarsCount = (comp.text?.match(/{{[0-9]+}}/g) || [])
                .length;
              const bodyParams: any[] = [];
              for (let i = 0; i < bodyVarsCount; i++) {
                if (variables[varIndex] !== undefined) {
                  bodyParams.push({
                    type: "text",
                    text: String(variables[varIndex++]),
                  });
                }
              }
              if (bodyParams.length > 0) {
                payload.template.components.push({
                  type: "BODY",
                  parameters: bodyParams,
                });
              }
            } else if (comp.type === "BUTTONS") {
              comp.buttons.forEach((btn: any, btnIdx: number) => {
                const btnVarsCount = (btn.url?.match(/{{[0-9]+}}/g) || [])
                  .length;
                if (btnVarsCount > 0) {
                  const btnParams: any[] = [];
                  for (let i = 0; i < btnVarsCount; i++) {
                    if (variables[varIndex] !== undefined) {
                      btnParams.push({
                        type: "text",
                        text: String(variables[varIndex++]),
                      });
                    }
                  }
                  payload.template.components.push({
                    type: "BUTTON",
                    sub_type: btn.type === "URL" ? "url" : "quick_reply",
                    index: String(btnIdx),
                    parameters: btnParams,
                  });
                }
              });
            }
          }
        } else {
          if (variables.length > 0) {
            payload.template.components.push({
              type: "BODY",
              parameters: variables.map((v) => ({
                type: "text",
                text: String(v),
              })),
            });
          }
        }
      } else if (finalMessageType === "text") {
        payload.text = { body: resolvedText || text };
      } else {
        if (!mediaId) throw new Error("Failed to upload media to WhatsApp");
        payload[finalMessageType] = {
          id: mediaId,
          caption: resolvedText || text,
        };
      }

      // 3. Send
      const response = await axios.post(
        `${WHATSAPP_API_URL}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      // 4. Update Message
      const incomingId = response.data.messages[0].id;
      const freshMessage = await Message.findById(message._id);
      if (freshMessage) {
        const currentP = STATUS_PRIORITY[freshMessage.status] || 0;
        const sentP = STATUS_PRIORITY["sent"];

        freshMessage.whatsappMessageId = incomingId;
        if (sentP > currentP) {
          freshMessage.status = "sent";
          freshMessage.statusHistory.push({
            status: "sent",
            timestamp: new Date(),
          });
        }
        await freshMessage.save();
        message.whatsappMessageId = freshMessage.whatsappMessageId;
        message.status = freshMessage.status;
      }

      // 5. Update Conversation
      const freshConversation = await Conversation.findById(conversationId);
      if (freshConversation) {
        const lastStatus = (freshConversation.lastMessageStatus || "queued") as string;
        const currentCP = STATUS_PRIORITY[lastStatus] || 0;
        const finalP = STATUS_PRIORITY[message.status] || 0;

        if (finalP > currentCP) {
          freshConversation.lastMessageStatus = message.status as any;
        }
        freshConversation.lastMessage = resolvedText || "";
        freshConversation.lastMessageId = message._id as mongoose.Types.ObjectId;
        freshConversation.lastMessageSender = "admin";
        await freshConversation.save();

        if (io) {
          if (replyToId) {
            await message.populate("replyTo");
          }
          io.to(clientCode).emit("message_sent", message.toObject());
          io.to(clientCode).emit(
            "conversation_updated",
            freshConversation.toObject(),
          );
        }
      }

      return message;
    } catch (e: any) {
      console.error("Send Error:", e.response?.data || e.message);
      message.status = "failed";
      message.error = JSON.stringify(e.response?.data || e.message);
      await message.save();

      if (io) {
        io.to(clientCode).emit("message_failed", message.toObject());
      }
      throw e;
    }
  };

  const syncTemplates = async (clientCode: string) => {
    try {
      const { secrets, Template } = await getContext(clientCode);
      const token = secrets.getDecrypted("whatsappToken");
      const wabaId = secrets.getDecrypted("whatsappBusinessId");

      if (!wabaId) {
        throw new Error("WhatsApp Business Account ID not found.");
      }

      const res = await axios.get(
        `${WHATSAPP_API_URL}/${wabaId}/message_templates`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const templates = res.data.data || [];

      for (const t of templates) {
        if (t.status !== "APPROVED") continue;

        let headerType: any = "NONE";
        const headerComp = t.components.find((c: any) => c.type === "HEADER");
        if (headerComp && headerComp.format) {
          headerType = headerComp.format;
        }

        const bodyComp = t.components.find((c: any) => c.type === "BODY");
        const rawBodyText = bodyComp ? bodyComp.text : "";
        const bodyText = rawBodyText.replace(/\n{3,}/g, "\n\n");
        const variablesCount = (bodyText.match(/{{[0-9]+}}/g) || []).length;

        const footerComp = t.components.find((c: any) => c.type === "FOOTER");
        const footerText = footerComp ? footerComp.text : undefined;

        const buttonsData: any[] = [];
        const buttonsComp = t.components.find((c: any) => c.type === "BUTTONS");
        if (buttonsComp && buttonsComp.buttons) {
          buttonsComp.buttons.forEach((b: any) => {
            buttonsData.push({
              type: b.type,
              text: b.text,
              url: b.url,
              phoneNumber: b.phone_number,
            });
          });
        }

        await Template.findOneAndUpdate(
          { name: t.name, language: t.language },
          {
            name: t.name,
            language: t.language,
            status: t.status,
            headerType,
            bodyText,
            variablesCount,
            footerText,
            buttons: buttonsData,
            components: t.components,
          },
          { upsert: true },
        );
      }
      return { success: true };
    } catch (err: any) {
      console.error("Template sync error:", err.message);
      throw err;
    }
  };

  const getTemplates = async (clientCode: string) => {
    try {
      const { Template } = await getContext(clientCode);
      return await Template.find({ status: "APPROVED" }).lean();
    } catch (err) {
      console.error("Get Templates Error:", err);
      return [];
    }
  };

  const sendReaction = async (clientCode: string, messageId: string, emoji: string) => {
    const { secrets, Message } = await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const message = await Message.findById(messageId);
    if (!message || !message.whatsappMessageId) throw new Error("Message not found on WhatsApp");

    const conversation = await (Message.db.model("Conversation", schemas.conversations)).findById(message.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: conversation.phone,
        type: "reaction",
        reaction: {
          message_id: message.whatsappMessageId,
          emoji,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (response.data.messages[0].id) {
        if (!Array.isArray(message.reactions)) {
            message.reactions = [];
        }
        const senderReactionIndex = message.reactions.findIndex((r) => r.reactBy === "admin");
        if (!emoji) {
            if (senderReactionIndex !== -1) message.reactions.splice(senderReactionIndex, 1);
        } else {
            if (senderReactionIndex !== -1) message.reactions[senderReactionIndex].emoji = emoji;
            else message.reactions.push({ emoji, reactBy: "admin" });
        }
        await message.save();

        if (io) {
            io.to(clientCode).emit("message_updated", {
                messageId: message._id,
                conversationId: message.conversationId,
                updates: { reactions: message.reactions },
            });
        }
    }

    return { success: true };
  };

  return {
    handleIncomingMessage,
    handleStatusUpdate,
    sendOutboundMessage,
    getTemplates,
    syncTemplates,
    sendReaction,
  };
};
