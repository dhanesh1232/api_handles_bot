import axios from "axios";
import FormData from "form-data";
import path from "path";
import { dbConnect } from "../../../lib/config.js";
import { ClientSecrets } from "../../../model/clients/secrets.js";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.js";
import { schemas } from "../../../model/saas/tenantSchemas.js";

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

const STATUS_PRIORITY = {
  read: 10,
  delivered: 8,
  failed: 5,
  sent: 3,
  queued: 1,
};

/**
 * WhatsApp Service Factory
 * @param {Socket} io - Socket.io instance
 */
export const createWhatsappService = (io) => {
  /**
   * Helper to get tenant context: Connection, Models, Secrets
   */
  const getContext = async (clientCode) => {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    const tenantConn = await getTenantConnection(clientCode);
    const Conversation = getTenantModel(
      tenantConn,
      "Conversation",
      schemas.conversations,
    );
    const Message = getTenantModel(tenantConn, "Message", schemas.messages);
    const Template = getTenantModel(tenantConn, "Template", schemas.templates);

    return { secrets, Conversation, Message, Template, tenantConn };
  };

  /**
   * Download Media from WhatsApp and Upload to R2 (via mediaService)
   */
  const processIncomingMedia = async (mediaId, secrets, originalFilename) => {
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
    } catch (e) {
      console.error("Media processing failed:", e.message);
      return null;
    }
  };

  // --- Core Methods ---

  const handleIncomingMessage = async (
    clientCode,
    messagePayload,
    from,
    msgBody,
    contacts,
  ) => {
    try {
      console.log(`[${clientCode}] Handling Incoming Message from: ${from}`);
      const { secrets, Conversation, Message } = await getContext(clientCode);

      const phone = from;
      const userName = contacts?.profile?.name || "Customer";
      const profilePicture = contacts?.profile?.profile_picture; // In case Meta adds it

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

      let mediaUrl = null;
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
              (r) => r.reactBy === from,
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
        return; // Reactions don't create new messages in our UI flow
      } else if (
        ![
          "text",
          "image",
          "document",
          "video",
          "audio",
          "interactive",
        ].includes(messageType)
      ) {
        console.log(
          `[${clientCode}] Info: Received unhandled message type: ${messageType}. Payload:`,
          JSON.stringify(messagePayload),
        );
      }

      // 2.5 Find Replied Message if any
      let replyTo = null;
      let replyToWhatsappId = null;
      if (messagePayload.context?.id) {
        replyToWhatsappId = messagePayload.context.id;
        const repliedMsg = await Message.findOne({
          whatsappMessageId: replyToWhatsappId,
        });
        if (repliedMsg) {
          replyTo = repliedMsg._id;
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
          status: "delivered", // Webhook confirms delivery to us
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
          conversation.lastMessageId = newMessage._id;
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

  const handleStatusUpdate = async (clientCode, statusPayload) => {
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
        const convPriority =
          STATUS_PRIORITY[conversation.lastMessageStatus] || 0;
        if (newPriority > convPriority) {
          conversation.lastMessageStatus = status;
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
    clientCode,
    conversationId,
    text,
    mediaUrl,
    mediaType,
    userId,
    templateName,
    templateLanguage = "en_US",
    variables = [],
    replyToId = null,
  ) => {
    const { secrets, Conversation, Message, Template } =
      await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error("Conversation not found");

    let replyToWhatsappId = null;
    if (replyToId) {
      const parentMsg = await Message.findById(replyToId);
      if (parentMsg && parentMsg.whatsappMessageId) {
        replyToWhatsappId = parentMsg.whatsappMessageId;
      }
    }

    const to = conversation.phone;
    let finalMessageType = "text";
    let resolvedText = text;

    // Logic for Template / Media / Text
    let templateData = null;
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
            const placeholder = `{{${idx + 1}}}`;
            // Correctly escape curly braces for literal matching in RegExp
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
          variables: variables, // Store used variables for reference
          headerType: tmpl.headerType,
        };
      } else {
        resolvedText = text || `Template: ${templateName}`;
      }
    } else if (mediaUrl) {
      finalMessageType = mediaType || "image";
    }

    // Save Queued Message
    const messageData = {
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

    // Update Conversation head immediately so webhooks for this message can find it correctly
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
      // 1. Upload Media to WhatsApp if needed (Direct media message)
      let mediaId = null;
      if (
        mediaUrl &&
        (["image", "video", "audio", "document"].includes(finalMessageType) ||
          finalMessageType === "template")
      ) {
        // Fetch stream from R2 public URL
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

      // 2. Build WhatsApp Payload
      const payload = {
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

          // Process Components in Order
          for (const comp of tmpl.components) {
            if (comp.type === "HEADER") {
              const headerParams = [];
              // Handle Media Header
              if (["IMAGE", "VIDEO", "DOCUMENT"].includes(comp.format)) {
                if (mediaId) {
                  headerParams.push({
                    type: comp.format,
                    [comp.format.toLowerCase()]: { id: mediaId },
                  });
                }
              }
              // Handle Header Text Variables
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
              const bodyParams = [];
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
              comp.buttons.forEach((btn, btnIdx) => {
                const btnVarsCount = (btn.url?.match(/{{[0-9]+}}/g) || [])
                  .length;
                if (btnVarsCount > 0) {
                  const btnParams = [];
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
          // Fallback if template components aren't synced properly
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
        // Media
        if (!mediaId) throw new Error("Failed to upload media to WhatsApp");
        payload[finalMessageType] = {
          id: mediaId,
          caption: resolvedText || text,
        };
      }

      // 3. Send
      console.log(
        `[${clientCode}] Outgoing WhatsApp Payload:`,
        JSON.stringify(payload, null, 2),
      );
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

      // 4. Update Message Safely (Atomic check for faster webhooks)
      const incomingId = response.data.messages[0].id;

      const freshMessage = await Message.findById(message._id);
      if (freshMessage) {
        const currentP = STATUS_PRIORITY[freshMessage.status] || 0;
        const sentP = STATUS_PRIORITY["sent"];

        freshMessage.whatsappMessageId = incomingId;
        // Only set to 'sent' if it's still 'queued' or 'failed' (don't overwrite 'delivered')
        if (sentP > currentP) {
          freshMessage.status = "sent";
          freshMessage.statusHistory.push({
            status: "sent",
            timestamp: new Date(),
          });
        }
        await freshMessage.save();

        // Sync local object for logging and emit
        message.whatsappMessageId = freshMessage.whatsappMessageId;
        message.status = freshMessage.status;
      }

      console.log(
        `✅ [${clientCode}] Outbound Message Processed: ${message._id} (Status: ${message.status})`,
      );

      // 5. Update Conversation Safely (Final Sync)
      const freshConversation = await Conversation.findById(conversationId);
      if (freshConversation) {
        // Only update status if it's an upgrade (respecting webhooks that might have fired already)
        const currentCP =
          STATUS_PRIORITY[freshConversation.lastMessageStatus] || 0;
        const finalP = STATUS_PRIORITY[message.status] || 0;

        if (finalP > currentCP) {
          freshConversation.lastMessageStatus = message.status;
        }

        // Always sync these metadata fields just in case
        freshConversation.lastMessage = resolvedText;
        freshConversation.lastMessageId = message._id;
        freshConversation.lastMessageSender = "admin";

        await freshConversation.save();

        // 6. Emit with fresh data
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
    } catch (e) {
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

  const syncTemplates = async (clientCode) => {
    try {
      const { secrets, Template } = await getContext(clientCode);
      const token = secrets.getDecrypted("whatsappToken");
      const wabaId = secrets.getDecrypted("whatsappBusinessId");

      if (!wabaId) {
        throw new Error("WhatsApp Business Account ID not found.");
      }

      // 1. Call Meta API
      const axios = (await import("axios")).default;
      const res = await axios.get(
        `${WHATSAPP_API_URL}/${wabaId}/message_templates`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const templates = res.data.data || [];
      let upsertCount = 0;

      // 2. Iterate through response
      for (const t of templates) {
        if (t.status !== "APPROVED") continue;

        // 4. Extract and Map
        let headerType = "NONE";
        const headerComp = t.components.find((c) => c.type === "HEADER");
        if (headerComp && headerComp.format) {
          headerType = headerComp.format;
        }

        const bodyComp = t.components.find((c) => c.type === "BODY");
        const rawBodyText = bodyComp ? bodyComp.text : "";
        const bodyText = rawBodyText.replace(/\n{3,}/g, "\n\n");
        const variablesCount = (bodyText.match(/{{[0-9]+}}/g) || []).length;

        const footerComp = t.components.find((c) => c.type === "FOOTER");
        const footerText = footerComp ? footerComp.text : undefined;

        const buttonsComp = t.components.find((c) => c.type === "BUTTONS");
        const buttons = (buttonsComp?.buttons || []).map((b) => ({
          type: b.type,
          text: b.text,
          url: b.url,
          phoneNumber: b.phone_number,
        }));

        // 5. Upsert into MongoDB
        await Template.findOneAndUpdate(
          { name: t.name, language: t.language },
          {
            status: t.status,
            category: t.category,
            components: t.components,
            headerType,
            bodyText,
            variablesCount,
            footerText,
            buttons,
            metaId: t.id,
            lastSyncedAt: new Date(),
          },
          { upsert: true, new: true },
        );
        upsertCount++;
      }

      console.log(
        `[${clientCode}] Sync complete: Upserted/Updated ${upsertCount}`,
      );
      return { success: true, count: upsertCount };
    } catch (error) {
      console.error(
        "Sync Templates Error:",
        error.response?.data || error.message,
      );
      throw error;
    }
  };

  const getTemplates = async (clientCode) => {
    try {
      const { Template } = await getContext(clientCode);
      return await Template.find({ status: "APPROVED" }).lean();
    } catch (err) {
      console.error("Get Templates Error:", err);
      return [];
    }
  };

  const sendReaction = async (clientCode, messageId, emoji) => {
    const { secrets, Message, Conversation } = await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const message = await Message.findById(messageId);
    if (!message) throw new Error("Message not found");
    if (!message.whatsappMessageId)
      throw new Error("Message has no WhatsApp ID");

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    // build payload
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.phone,
      type: "reaction",
      reaction: {
        message_id: message.whatsappMessageId,
        emoji: emoji || "",
      },
    };

    try {
      await axios.post(`${WHATSAPP_API_URL}/${phoneId}/messages`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      // Update Local Message with Array Logic
      if (!Array.isArray(message.reactions)) {
        message.reactions = [];
      }

      const adminReactionIndex = message.reactions.findIndex(
        (r) => r.reactBy === "admin",
      );

      if (!emoji) {
        // Remove admin reaction
        if (adminReactionIndex !== -1) {
          message.reactions.splice(adminReactionIndex, 1);
        }
      } else {
        // Update or Add
        if (adminReactionIndex !== -1) {
          message.reactions[adminReactionIndex].emoji = emoji;
        } else {
          message.reactions.push({ emoji, reactBy: "admin" });
        }
      }

      await message.save();

      // Emit
      if (io) {
        io.to(clientCode).emit("message_updated", {
          messageId: message._id,
          conversationId: message.conversationId,
          updates: { reactions: message.reactions },
        });
      }

      return { success: true, reactions: message.reactions };
    } catch (e) {
      console.error("Reaction Error:", e.response?.data || e.message);
      throw e;
    }
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
