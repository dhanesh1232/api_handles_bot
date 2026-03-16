import path from "node:path";
import { dbConnect } from "@lib/config";
import { tenantLogger } from "@lib/logger";
import { MetaWhatsAppClient } from "@lib/meta/whatsapp.client";
import { getCrmModels } from "@lib/tenant/crm.models";
import { ClientSecrets } from "@models/clients/secrets";
import { createNotification } from "@services/saas/crm/notification.service";
import { normalizePhone } from "@utils/phone";
import axios from "axios";
import FormData from "form-data";
import mongoose from "mongoose";
import { Server } from "socket.io";

const WHATSAPP_API_URL = "https://graph.facebook.com/v24.0";

const STATUS_PRIORITY: Record<string, number> = {
  read: 10,
  delivered: 8,
  failed: 5,
  sent: 3,
  queued: 1,
};

/**
 * WhatsApp Service Factory
 * @param {Server | null} io - Socket.io instance
 */
export const createWhatsappService = (io: Server | null) => {
  /**
   * Helper to get tenant context: Connection, Models, Secrets
   */
  // Helper to get tenant context: Connection, Models, Secrets
  const getContext = async (
    clientCode: string,
  ): Promise<WhatsAppServiceContext> => {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({
      clientCode: clientCode.toUpperCase(),
    });
    if (!secrets) throw new Error("Client secrets not found");

    const {
      Conversation,
      Message,
      Template,
      conn: tenantConn,
    } = await getCrmModels(clientCode);

    return { secrets, Conversation, Message, Template, tenantConn };
  };

  /**
   * Download Media from WhatsApp and Upload to R2 (via mediaService)
   */
  const processIncomingMedia = async (
    mediaId: string,
    secrets: any,
    originalFilename?: string,
  ): Promise<string | null> => {
    if (!mediaId) return null;
    try {
      const metaClient = MetaWhatsAppClient.fromSecrets(secrets);

      // 1. Resolve media URL + MIME type
      const resolved = await metaClient.resolveMediaUrl(mediaId);
      if (!resolved) return null;

      // 2. Download buffer
      const buffer = await metaClient.downloadMedia(resolved.url);
      if (!buffer) return null;

      // 3. Optimize & Upload
      const { optimizeAndUploadMedia } = await import(
        "@services/saas/media/media.service"
      );
      const result = await optimizeAndUploadMedia(
        buffer,
        resolved.mimeType,
        originalFilename,
        mediaId,
        secrets,
      );

      return result.url;
    } catch (e: any) {
      tenantLogger("unknown").error({ err: e }, "Media processing failed");
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
    const log = tenantLogger(clientCode);
    try {
      log.info({ from }, "Handling incoming WhatsApp message");
      const { secrets, Conversation, Message } = await getContext(clientCode);

      const phone = normalizePhone(from);
      const metaName = contacts?.profile?.name || "Customer";
      const profilePicture = contacts?.profile?.profile_picture;

      // --- Lead Syncing Logic ---
      const { getCrmModels } = await import("@lib/tenant/crm.models");
      const { Lead } = await getCrmModels(clientCode);

      let lead: any = await Lead.findOne({
        phone,
        clientCode,
        isArchived: false,
      }).lean();
      if (!lead) {
        // Create a new lead automatically
        const { createLead } = await import("@services/saas/crm/lead.service");
        try {
          lead = await createLead(clientCode, {
            firstName: metaName !== "Customer" ? metaName : "WhatsApp User",
            phone: phone,
            source: "whatsapp",
            tags: ["auto-created"],
          });
          log.info({ phone }, "Auto-created lead from WhatsApp");
        } catch (err: any) {
          log.warn({ err, phone }, "Failed to auto-create lead");
        }
      }

      // Determine the best name for the conversation:
      // Priority: 1. Lead Full Name (if they have a real name), 2. Meta Name, 3. Phone/Customer
      let bestName = metaName !== "Customer" ? metaName : phone;
      if (lead) {
        // lead.fullName is a virtual, we can construct it manually if not populated
        const leadFullName = [lead.firstName, lead.lastName]
          .filter(Boolean)
          .join(" ");
        if (
          leadFullName &&
          leadFullName !== "WhatsApp User" &&
          leadFullName !== phone
        ) {
          bestName = leadFullName;
        }
      }

      // 1. Find or Create Conversation
      let conversation = await Conversation.findOne({ phone });
      if (!conversation) {
        conversation = await Conversation.create({
          phone,
          userName: bestName,
          profilePicture: profilePicture,
          status: "open",
          channel: "whatsapp",
          unreadCount: 0,
        });
        log.info(
          { conversationId: conversation._id },
          "New conversation created",
        );
      } else {
        // Update name if changed
        if (conversation.userName !== bestName) {
          conversation.userName = bestName;
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
        log.debug(
          { messageId: messagePayload.id },
          "Duplicate message ignored",
        );
        return;
      }

      let mediaUrl: string | null = null;
      const rawType = String(messagePayload.type || "text").trim().toLowerCase();
      const messageType = rawType;
      let finalMsgBody = msgBody;

      // Handle standard and system types
      if (messageType === "text") {
        // text is naturally handled by the msgBody passed from the route
      } else if (messageType === "system") {
        finalMsgBody = messagePayload.system?.body || "System Update";
      } else if (messageType === "interactive") {
        const iType = messagePayload.interactive?.type;
        if (iType === "button_reply") {
          finalMsgBody = messagePayload.interactive.button_reply?.title;
        } else if (iType === "list_reply") {
          finalMsgBody = messagePayload.interactive.list_reply?.title;
        }
      } else if (messageType === "button") {
        finalMsgBody = messagePayload.button?.text;
      } else if (messageType === "location") {
        const loc = messagePayload.location;
        finalMsgBody = `📍 Location: ${loc.name || loc.address || "Pinned Location"}\nhttps://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
      } else if (messageType === "contacts") {
        const contactsArr = messagePayload.contacts || [];
        finalMsgBody = contactsArr
          .map((c: any) => {
            const name =
              c.name?.formatted_name || c.name?.first_name || "Contact";
            const phone = c.phones?.[0]?.phone || "No phone";
            return `👤 Contact: ${name} (${phone})`;
          })
          .join("\n");
      } else if (messageType === "sticker") {
        mediaUrl = await processIncomingMedia(
          messagePayload.sticker?.id,
          secrets,
        );
        finalMsgBody = "Sticker";
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
      } else {
        // Fallback for unknown or unsupported message types
        finalMsgBody = `[Unsupported message: ${messageType}]`;
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
        log.debug({ from }, "Skipping empty inbound message");
        return;
      }

      try {
        const newMessage = await Message.create({
          conversationId: conversation._id,
          direction: "inbound",
          messageType,
          text: finalMsgBody,
          mediaUrl: mediaUrl || undefined,
          whatsappMessageId: messagePayload.id,
          replyTo: replyTo || undefined,
          replyToWhatsappId: replyToWhatsappId || undefined,
          status: "delivered",
        });
        log.info({ messageId: newMessage._id }, "Inbound message saved");

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
        if (lead) {
          await Lead.updateOne(
            { _id: lead._id },
            { $set: { lastContactedAt: new Date() } },
          );
        }

        // 5. Emit Socket
        if (io) {
          // Update in-memory object for emit
          conversation.lastMessage = finalMsgBody;
          conversation.lastMessageAt = new Date();
          conversation.lastMessageSender = "user";
          conversation.lastMessageType = messageType;
          conversation.lastUserMessageAt = new Date();
          conversation.lastMessageId =
            newMessage._id as mongoose.Types.ObjectId;
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

        // 6. Emit to EventBus for Automations
        try {
          const { EventBus } = await import("../event/eventBus.service.ts");
          await EventBus.emit(
            clientCode,
            "whatsapp.incoming",
            {
              phone,
              variables: {
                message: finalMsgBody,
                sender_name: bestName,
                conversation_id: conversation._id.toString(),
              },
              data: {
                messageType,
                whatsappMessageId: messagePayload.id,
                isFirstMessage: conversation.unreadCount === 1,
              },
            },
            {
              createLeadIfMissing: true,
              leadData: { firstName: bestName, source: "whatsapp" },
            },
          );
        } catch (eventErr: any) {
          tenantLogger(clientCode).error(
            { err: eventErr },
            "[WhatsAppService] Failed to emit whatsapp.incoming",
          );
        }
      } catch (saveError) {
        tenantLogger(clientCode).error(
          { err: saveError },
          "Failed to save incoming message",
        );
      }
    } catch (err) {
      tenantLogger(clientCode).error(
        { err },
        "Error handling incoming WhatsApp message",
      );
    }
  };

  const notifyFailure = async (
    clientCode: string,
    conversation: any,
    message: any,
    errors: any,
  ) => {
    tenantLogger(clientCode).debug(
      { messageId: message?._id, errors },
      "[WhatsAppService] notifyFailure triggered",
    );

    try {
      const errorData = errors
        ? Array.isArray(errors)
          ? errors[0]
          : errors
        : {};

      const errorCode = errorData.code;
      const errorMessage =
        errorData.message || (typeof errors === "string" ? errors : "");

      // Attempt to detect 24h window from message if code is missing
      const isWindowClosed =
        errorCode === 131047 ||
        errorMessage.includes("24 hours") ||
        errorMessage.includes("131047");

      tenantLogger(clientCode).debug(
        { errorCode, isWindowClosed, errorMessage },
        "[WhatsAppService] Error analysis",
      );

      const lead = await (async () => {
        try {
          const { Lead } = await getCrmModels(clientCode);
          return await Lead.findOne({
            phone: conversation?.phone,
            clientCode,
            isArchived: false,
          });
        } catch (e) {
          tenantLogger(clientCode).warn(
            { err: e },
            "Failed to find lead for notification",
          );
          return null;
        }
      })();

      const notifData = {
        title: isWindowClosed
          ? "WhatsApp Window Closed"
          : "WhatsApp delivery failed",
        message: isWindowClosed
          ? `Cannot send regular message to ${conversation?.userName || conversation?.phone}. 24h window closed. Please use a template.`
          : `Message to ${conversation?.userName || conversation?.phone} failed: ${errorMessage || "Unknown error"}`,
        type: isWindowClosed ? "alert" : "action_required",
        actionData: {
          errorType: isWindowClosed
            ? "whatsapp_window_closed"
            : "whatsapp_delivery_failed",
          leadId: lead?._id,
          conversationId: conversation?._id,
          messageId: message?._id,
          errorCode,
          actionConfig: {
            type: "send_whatsapp",
            text: message?.text,
            templateName: message?.templateData?.name,
            templateLanguage: message?.templateData?.language,
            variables: message?.templateData?.variables,
          },
        },
      };

      const notif = await createNotification(clientCode, notifData);

      tenantLogger(clientCode).info(
        { notificationId: notif._id, isWindowClosed },
        "[WhatsAppService] Failure notification successfully created",
      );
    } catch (notifErr) {
      tenantLogger(clientCode).error(
        { err: (notifErr as any).message || notifErr },
        "[WhatsAppService] Failed to create failure notification",
      );
    }
  };

  const handleStatusUpdate = async (clientCode: string, statusPayload: any) => {
    try {
      const { Message, Conversation } = await getContext(clientCode);
      const { id, status, errors } = statusPayload;

      let message = await Message.findOne({ whatsappMessageId: id });

      // FIX: Race condition where webhook arrives before persistence
      if (!message) {
        tenantLogger(clientCode).debug(
          { whatsappMessageId: id },
          "Message not found in status update, retrying...",
        );
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
          message = await Message.findOne({ whatsappMessageId: id });
          if (message) break;
        }
      }

      if (!message) return;

      const currentPriority = STATUS_PRIORITY[message.status] || 0;
      const newPriority = STATUS_PRIORITY[status] || 0;

      // GUARD: Only update if the new status has higher OR EQUAL priority (to allow error updates)
      if (newPriority >= currentPriority) {
        // Special case: if already failed, we might still want to update error info but avoid redundant notifications
        const alreadyFailed = message.status === "failed";

        message.status = status;

        // Clear errors if the message is now successful
        if (status === "delivered" || status === "read") {
          message.error = undefined;
        } else if (errors) {
          message.error = JSON.stringify(errors);
        }

        message.statusHistory.push({ status, timestamp: new Date() });
        await message.save();

        // 🎉 Also update Meeting reminders if linked
        if (message.metadata?.meetingId && message.metadata?.actionId) {
          const { getCrmModels } = await import(
            "../../../lib/tenant/crm.models"
          );
          const { Meeting } = await getCrmModels(clientCode);
          // Only update if current status in meeting is lower priority
          const meeting = await Meeting.findById(message.metadata.meetingId);
          if (meeting?.reminders) {
            const reminderIndex = meeting.reminders.findIndex(
              (r: any) => r.actionId === message.metadata?.actionId,
            );
            if (reminderIndex !== -1) {
              const currentRemStatus =
                meeting.reminders[reminderIndex].status || "pending";
              const currentRemPriority = STATUS_PRIORITY[currentRemStatus] || 0;

              if (newPriority > currentRemPriority) {
                meeting.reminders[reminderIndex].status = status as any;
                if (status === "failed") {
                  meeting.reminders[reminderIndex].error = message.error;
                } else {
                  meeting.reminders[reminderIndex].error = undefined;
                }
                await meeting.save();
              }
            }
          }
        }

        const conversation = await Conversation.findById(
          message.conversationId,
        );
        if (
          conversation &&
          conversation.lastMessageId?.toString() === message._id.toString()
        ) {
          const lastStatus = (conversation.lastMessageStatus ||
            "queued") as string;
          const convPriority = STATUS_PRIORITY[lastStatus] || 0;
          if (newPriority > convPriority) {
            conversation.lastMessageStatus = status as any;
            await conversation.save();
          }
        }

        // Emit Status Update
        if (io) {
          io.to(clientCode).emit("message_status_update", {
            messageId: message._id,
            conversationId: message.conversationId,
            status,
            statusHistory: message.statusHistory,
            whatsappMessageId: id,
            meetingId: message.metadata?.meetingId, // Include for frontend sync if needed
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

        // 🔔 Trigger Notifications for Failures (only if not already failed to prevent loops)
        if (status === "failed" && !alreadyFailed) {
          await notifyFailure(clientCode, conversation, message, errors);
        }
      } else {
        if (status !== message.status) {
          tenantLogger(clientCode).debug(
            {
              currentStatus: message.status,
              incomingStatus: status,
              messageId: id,
            },
            "Status update skipped (priority protection)",
          );
        }
        return;
      }
    } catch (err) {
      tenantLogger(clientCode).error(
        { err },
        "Error handling WhatsApp status update",
      );
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
    metadata?: Record<string, any>,
    filename?: string,
  ) => {
    const { secrets, Conversation, Message, Template, tenantConn } =
      await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error("Conversation not found");

    let replyToWhatsappId: string | null = null;
    if (replyToId) {
      const parentMsg = await Message.findById(replyToId);
      if (parentMsg?.whatsappMessageId) {
        replyToWhatsappId = parentMsg.whatsappMessageId;
      }
    }

    const to = conversation.phone;
    let finalMessageType: any = "text";
    let resolvedText = text;

    // Logic for Template / Media / Text
    let templateData: IMessageTemplateData | undefined;
    if (templateName) {
      finalMessageType = "template";
      let tmpl = null;

      // Unified resolution attempt if it's a template
      if (metadata || !variables || variables.length === 0) {
        try {
          const { resolveUnifiedWhatsAppTemplate } = await import(
            "./template.service"
          );
          const { getCrmModels } = await import("@lib/tenant/crm.models");
          const { Lead } = await getCrmModels(clientCode);

          // We try to find a lead if metadata has an ID but not the object
          const rootLead =
            metadata?.lead ||
            (metadata?.leadId ? await Lead.findById(metadata.leadId) : {});

          const resolution = await resolveUnifiedWhatsAppTemplate(
            tenantConn,
            templateName,
            rootLead || {},
            metadata?.vars || metadata?.event || metadata || {},
          );
          variables = resolution.resolvedVariables;
          templateLanguage = resolution.languageCode;
          tmpl = resolution.template;
          tenantLogger(clientCode).debug(
            { templateName, templateLanguage },
            "[WhatsAppService] Unified template resolution complete",
          );
        } catch (resErr: any) {
          tenantLogger(clientCode).warn(
            { templateName, err: resErr.message },
            "[WhatsAppService] Unified mapping failed, falling back to static",
          );
        }
      }

      if (!tmpl) {
        tmpl = await Template.findOne({
          name: templateName,
          language: templateLanguage,
        });
      }

      if (tmpl) {
        let content = tmpl.bodyText;
        const bodyVars = content.match(/{{[0-9]+}}/g) || [];
        for (const placeholder of bodyVars) {
          const index = parseInt(placeholder.replace(/{{|}}/g, ""), 10);
          const mapping = tmpl.variableMapping.find(
            (m: any) => m.componentType === "BODY" && m.originalIndex === index,
          );
          if (mapping) {
            const val =
              variables[mapping.position - 1] ?? mapping.fallback ?? "";
            const regex = new RegExp(`\\{\\{${index}\\}\\}`, "g");
            content = content.replace(regex, String(val));
          }
        }
        resolvedText = content;
        templateData = {
          name: templateName,
          language: templateLanguage,
          footer: tmpl.footerText,
          buttons: tmpl.buttons,
          variables: variables,
          headerType: tmpl.headerType,
          headerFilename: filename,
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
      filename,
      metadata,
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
    tenantLogger(clientCode).info(
      { messageId: message._id },
      "Outbound WhatsApp message queued",
    );

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
      { returnDocument: "after" },
    );

    if (io && conv) {
      io.to(clientCode).emit("conversation_updated", conv.toObject());

      const ioPayload = {
        ...conv.toObject(),
        message: message.toObject(),
        clientCode,
      };
      io.to(clientCode).emit("new_message", ioPayload);
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
          channel: "whatsapp",
        });

        payload.template = {
          name: templateName,
          language: { code: templateLanguage },
          components: [],
        };

        const getVarValue = (
          compType: string,
          origIdx: number,
          btnIdx?: number,
          exampleVal?: string,
        ) => {
          const mapping = tmpl?.variableMapping?.find(
            (m: any) =>
              m.componentType === compType &&
              m.originalIndex === origIdx &&
              (btnIdx === undefined || m.componentIndex === btnIdx),
          );

          if (mapping) {
            const val =
              variables[mapping.position - 1] ?? mapping.fallback ?? "[N/A]";
            return val;
          }

          // Fallback for older templates or if mapping is missing one field
          // If origIdx is 0 (virtual), we try variables[0] directly as a common convention
          const val =
            variables[origIdx === 0 ? 0 : origIdx - 1] ?? exampleVal ?? "[N/A]";
          return val;
        };

        if (tmpl?.components && tmpl.components.length > 0) {
          tenantLogger(clientCode).debug(
            { templateName },
            "Using cached template components structure",
          );

          for (const comp of tmpl.components) {
            if (comp.type === "HEADER") {
              const headerParams: any[] = [];
              if (["IMAGE", "VIDEO", "DOCUMENT"].includes(comp.format)) {
                const headerUrl = getVarValue("HEADER", 0);
                tenantLogger(clientCode).debug(
                  { templateName, headerUrl, format: comp.format },
                  "[WhatsApp] Resolved HEADER URL",
                );
                if (headerUrl && headerUrl !== "[N/A]") {
                  const headerDoc: any = { link: headerUrl };
                  if (comp.format === "DOCUMENT") {
                    try {
                      const pathname = new URL(headerUrl).pathname;
                      headerDoc.filename =
                        filename || path.basename(pathname) || "Document.pdf";
                    } catch (_e) {
                      headerDoc.filename = filename || "Document.pdf";
                    }
                  }
                  headerParams.push({
                    type: comp.format.toLowerCase(),
                    [comp.format.toLowerCase()]: headerDoc,
                  });
                } else if (mediaId) {
                  const headerDoc: any = { id: mediaId };
                  if (comp.format === "DOCUMENT") {
                    headerDoc.filename = filename || "Document.pdf";
                  }
                  headerParams.push({
                    type: comp.format.toLowerCase(),
                    [comp.format.toLowerCase()]: headerDoc,
                  });
                } else {
                  tenantLogger(clientCode).warn(
                    { templateName },
                    "[WhatsApp] Media header defined but no URL or ID found. Meta API may reject this payload.",
                  );
                }
              }
              const headerVars = comp.text?.match(/{{[0-9]+}}/g) || [];
              for (const placeholder of headerVars) {
                const index = parseInt(placeholder.replace(/{{|}}/g, ""), 10);
                const val = getVarValue(
                  "HEADER",
                  index,
                  undefined,
                  comp.example?.header_text?.[0],
                );
                headerParams.push({
                  type: "text",
                  text: String(val),
                });
              }
              if (headerParams.length > 0) {
                payload.template.components.push({
                  type: "header",
                  parameters: headerParams,
                });
              }
            } else if (comp.type === "BODY") {
              const bodyVars = comp.text?.match(/{{[0-9]+}}/g) || [];
              const bodyParams: any[] = [];
              for (const placeholder of bodyVars) {
                const index = parseInt(placeholder.replace(/{{|}}/g, ""), 10);
                const val = getVarValue(
                  "BODY",
                  index,
                  undefined,
                  comp.example?.body_text?.[0]?.[index - 1],
                );
                bodyParams.push({
                  type: "text",
                  text: String(val),
                });
              }
              if (bodyParams.length > 0) {
                payload.template.components.push({
                  type: "body",
                  parameters: bodyParams,
                });
              }
            } else if (comp.type === "BUTTONS") {
              comp.buttons.forEach((btn: any, btnIdx: number) => {
                const isUrl = btn.type === "URL";
                const btnVars =
                  (isUrl ? btn.url : btn.text)?.match(/{{[0-9]+}}/g) || [];
                if (btnVars.length > 0) {
                  const btnParams: any[] = [];
                  for (const placeholder of btnVars) {
                    const index = parseInt(
                      placeholder.replace(/{{|}}/g, ""),
                      10,
                    );
                    const val = getVarValue(
                      "BUTTON",
                      index,
                      btnIdx,
                      btn.example?.[0],
                    );
                    const strVal = String(val ?? "").trim();
                    if (!strVal || strVal === "[N/A]") {
                      throw new Error(
                        `Required button parameter {{${index}}} resolved to an empty value.`,
                      );
                    }
                    btnParams.push({ type: "text", text: strVal });
                  }
                  if (btnParams.length > 0) {
                    payload.template.components.push({
                      type: "button",
                      sub_type: isUrl ? "url" : "quick_reply",
                      index: String(btnIdx),
                      parameters: btnParams,
                    });
                  }
                }
              });
            }
          }
        } else if (tmpl) {
          // Robust Fallback: Distribute variables according to mapping even if comp structure is missing from DB
          tenantLogger(clientCode).warn(
            { templateName },
            "Template components missing from DB. Attempting robust mapping-aware reconstruction.",
          );

          // 1. Header Fallback
          const headerType = tmpl.headerType;
          if (
            headerType &&
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)
          ) {
            const val = getVarValue("HEADER", 0);
            if (val && val !== "[N/A]") {
              const format = headerType.toLowerCase();
              const headerDoc: any = { link: val };
              if (headerType === "DOCUMENT") {
                try {
                  const pathname = new URL(val).pathname;
                  headerDoc.filename =
                    filename || path.basename(pathname) || "Document.pdf";
                } catch (_e) {
                  headerDoc.filename = filename || "Document.pdf";
                }
              }
              payload.template.components.push({
                type: "header",
                parameters: [{ type: format, [format]: headerDoc }],
              });
            } else if (mediaId) {
              const format = headerType.toLowerCase();
              const headerDoc: any = { id: mediaId };
              if (headerType === "DOCUMENT") {
                headerDoc.filename = filename || "Document.pdf";
              }
              payload.template.components.push({
                type: "header",
                parameters: [{ type: format, [format]: headerDoc }],
              });
            }
          }

          // 2. Body Fallback
          const bodyMappings = tmpl.variableMapping
            .filter((m: any) => m.componentType === "BODY")
            .sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));

          if (bodyMappings.length > 0) {
            const bodyParams = bodyMappings.map((m: any) => ({
              type: "text",
              text: String(variables[m.position - 1] ?? m.fallback ?? "[N/A]"),
            }));
            payload.template.components.push({
              type: "body",
              parameters: bodyParams,
            });
          } else if (variables.length > 0) {
            // Last resort: map all variables to body if no mapping exists
            payload.template.components.push({
              type: "body",
              parameters: variables.map((v) => ({
                type: "text",
                text: String(v),
              })),
            });
          }
        } else {
          // No template object at all - very rare naive fallback
          if (variables.length > 0) {
            payload.template.components.push({
              type: "body",
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
        const mediaPayload: any = {
          id: mediaId,
        };

        // Meta API: Audio and Stickers do not support captions
        if (!["audio", "sticker"].includes(finalMessageType)) {
          mediaPayload.caption = resolvedText || text;
        }

        // Send audio as a voice message if it's type audio
        if (finalMessageType === "audio") {
          mediaPayload.voice = true;
        }

        if (finalMessageType === "document") {
          if (mediaUrl) {
            try {
              const pathname = new URL(mediaUrl).pathname;
              mediaPayload.filename =
                filename || path.basename(pathname) || "Document.pdf";
            } catch (_e) {
              mediaPayload.filename = filename || "Document.pdf";
            }
          }
        }
        payload[finalMessageType] = mediaPayload;
      }

      // 3. Send
      tenantLogger(clientCode).debug(
        { templateName, payloadType: payload.type },
        "[WhatsApp] Sending Meta API payload",
      );

      // 2.5 Credit Guard: Weaponizing with Wealth Engine
      const { UsageService } = await import("@services/global/usage.service");
      const hasCredits = await UsageService.consume(
        clientCode,
        "whatsapp_msg",
        1,
      );
      if (!hasCredits) {
        throw new Error(
          "Insufficient credits: Your agency/account has exhausted its WhatsApp message quota for this month.",
        );
      }

      tenantLogger(clientCode).info(
        { recipient: to, payload },
        "[WhatsApp] Outbound payload trace",
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
      tenantLogger(clientCode).debug(
        { response: response.data },
        "WhatsApp Meta API response",
      );

      // 4. Update Message
      const incomingId = response.data.messages[0].id;
      const freshMessage = await Message.findById(message._id);
      if (freshMessage) {
        freshMessage.whatsappMessageId = incomingId;
        freshMessage.status = "sent";
        freshMessage.statusHistory.push({
          status: "sent",
          timestamp: new Date(),
        });
        await freshMessage.save();

        // Update the local message object for consistent socket emission
        message.whatsappMessageId = freshMessage.whatsappMessageId;
        message.status = freshMessage.status;
        message.statusHistory = freshMessage.statusHistory;
      }

      // 5. Update Conversation
      const freshConversation = await Conversation.findById(conversationId);
      if (freshConversation) {
        const lastStatus = (freshConversation.lastMessageStatus ||
          "queued") as string;
        const currentCP = STATUS_PRIORITY[lastStatus] || 0;
        const finalP = STATUS_PRIORITY[message.status] || 0;

        if (finalP > currentCP) {
          freshConversation.lastMessageStatus = message.status as any;
        }
        freshConversation.lastMessage = resolvedText || "";
        freshConversation.lastMessageId =
          message._id as mongoose.Types.ObjectId;
        freshConversation.lastMessageSender = "admin";
        await freshConversation.save();

        // 🎉 Also update Lead's lastContactedAt
        const { getCrmModels } = await import("../../../lib/tenant/crm.models");
        const { Lead } = await getCrmModels(clientCode);
        await Lead.updateOne(
          { phone: freshConversation.phone, clientCode, isArchived: false },
          { $set: { lastContactedAt: new Date() } },
        );

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
      const errorPayload = e.response?.data || e.message;
      tenantLogger(clientCode).error(
        { err: errorPayload },
        "[WhatsAppService] Outbound message sending failed",
      );

      message.status = "failed";
      message.error = JSON.stringify(errorPayload);
      await message.save();

      if (io) {
        io.to(clientCode).emit("message_failed", message.toObject());
      }

      // 🔔 Trigger Notifications for Failures
      try {
        const conversation = await Conversation.findById(conversationId);
        const errors = e.response?.data?.error;
        tenantLogger(clientCode).debug(
          { messageId: message._id, errorCode: errors?.code },
          "[WhatsAppService] Passing error to notifyFailure",
        );
        await notifyFailure(
          clientCode,
          conversation,
          message,
          errors || e.message,
        );
      } catch (notifTriggerErr) {
        tenantLogger(clientCode).error(
          { err: notifTriggerErr },
          "[WhatsAppService] Fatal error while triggering failure notification",
        );
      }
      throw e;
    }
  };

  const sendReaction = async (
    clientCode: string,
    messageId: string,
    emoji: string,
  ) => {
    const { secrets, Message, Conversation } = await getContext(clientCode);
    const token = secrets.getDecrypted("whatsappToken");
    const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

    const message = await Message.findById(messageId);
    if (!message || !message.whatsappMessageId)
      throw new Error("Message not found on WhatsApp");

    const conversation = await Conversation.findById(message.conversationId);
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
      const senderReactionIndex = (
        message.reactions as IMessageReaction[]
      ).findIndex((r) => r.reactBy === "admin");
      if (!emoji) {
        if (senderReactionIndex !== -1)
          message.reactions.splice(senderReactionIndex, 1);
      } else {
        if (senderReactionIndex !== -1)
          message.reactions[senderReactionIndex].emoji = emoji;
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
    sendReaction,
  };
};
