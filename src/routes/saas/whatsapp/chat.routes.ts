import express, { type Request, type Response } from "express";
import multer from "multer";
import { Server } from "socket.io";
import { dbConnect } from "../../../lib/config.ts";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { ClientSecrets } from "../../../model/clients/secrets.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";
import type { IConversation } from "../../../model/saas/whatsapp/conversation.model.ts";
import type { IMessage } from "../../../model/saas/whatsapp/message.model.ts";
import { optimizeAndUploadMedia } from "../../../services/saas/media/media.service.ts";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsapp.service.ts";

const upload = multer({ storage: multer.memoryStorage() });

export interface SaasRequest extends Request {
  clientCode: string;
  user?: any;
}

export const createChatRouter = (io: Server) => {
  const router = express.Router();
  const whatsappService = createWhatsappService(io);

  // 1. List Conversations
  router.get(
    "/conversations",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const conn = await getTenantConnection(clientCode);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );

        const conversations = await ConversationModel.find({}).sort({
          lastMessageAt: -1,
        });
        res.json({ success: true, data: conversations });
      } catch (err: any) {
        console.error("Error fetching conversations:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to fetch chats",
        });
      }
    },
  );

  // 2. Get Messages for a Conversation
  router.get(
    "/conversations/:id/messages",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { id } = req.params;

        const conn = await getTenantConnection(clientCode);
        const MessageModel = getTenantModel<IMessage>(
          conn,
          "Message",
          schemas.messages,
        );

        const messages = await MessageModel.find({ conversationId: id as any })
          .populate("replyTo")
          .sort({
            createdAt: 1,
          });

        res.json({ success: true, data: messages });
      } catch (err: any) {
        console.error("Error fetching messages:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to fetch messages",
        });
      }
    },
  );

  // 3. Mark Conversation as Read
  router.post(
    "/conversations/:id/read",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { id } = req.params;

        const conn = await getTenantConnection(clientCode);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );

        await ConversationModel.updateOne(
          { _id: id as any },
          { $set: { unreadCount: 0 } },
        );

        res.json({ success: true });
      } catch (err: any) {
        console.error("Error marking read:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to mark as read",
        });
      }
    },
  );

  // 4. Create New Conversation manually
  router.post(
    "/conversations",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { phone, name } = req.body;

        const conn = await getTenantConnection(clientCode);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );

        let conversation = await ConversationModel.findOne({ phone });
        if (!conversation) {
          // Attempt to find lead for a better name
          const { getCrmModels } =
            await import("../../../lib/tenant/get.crm.model.ts");
          const { Lead } = await getCrmModels(clientCode);
          const lead = await Lead.findOne({ phone, clientCode }).lean();

          let resolvedName = name;
          if (!resolvedName && lead) {
            resolvedName = [lead.firstName, lead.lastName]
              .filter(Boolean)
              .join(" ");
          }
          if (!resolvedName) {
            const count = await ConversationModel.countDocuments();
            resolvedName = `Customer ${count + 1}`;
          }

          conversation = await ConversationModel.create({
            phone,
            userName: resolvedName,
            status: "open",
            channel: "whatsapp",
            unreadCount: 0,
            lastMessageAt: new Date(),
          });

          // Emit to socket so sidebar updates everywhere
          io.to(clientCode).emit(
            "conversation_updated",
            conversation.toObject(),
          );
        }

        res.json({ success: true, data: conversation });
      } catch (err: any) {
        console.error("Error creating chat:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to create chat",
        });
      }
    },
  );

  // 4a. Delete Conversation
  router.delete(
    "/conversations/:id",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { id } = req.params;

        const conn = await getTenantConnection(clientCode);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );
        const MessageModel = getTenantModel<IMessage>(
          conn,
          "Message",
          schemas.messages,
        );

        await MessageModel.deleteMany({ conversationId: id });
        await ConversationModel.findByIdAndDelete(id);

        // Notify all clients
        io.to(clientCode).emit("conversation_deleted", { conversationId: id });

        res.json({ success: true });
      } catch (err: any) {
        console.error("Error deleting conversation:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to delete conversation",
        });
      }
    },
  );

  // 5. Upload Media to R2
  router.post(
    "/upload",
    validateClientKey,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const file = req.file;

        if (!file) {
          return res
            .status(400)
            .json({ success: false, message: "No file provided" });
        }

        await dbConnect("services");
        const secrets = await ClientSecrets.findOne({ clientCode });

        if (!secrets) {
          return res
            .status(404)
            .json({ success: false, message: "Client secrets not found" });
        }

        const result = await optimizeAndUploadMedia(
          file.buffer,
          file.mimetype,
          file.originalname,
          `chat_${Date.now()}`,
          secrets,
        );

        let type = "document";
        if (result.mimeType.startsWith("image/")) type = "image";
        else if (result.mimeType.startsWith("video/")) type = "video";
        else if (result.mimeType.startsWith("audio/")) type = "audio";

        res.json({ success: true, data: { url: result.url, type } });
      } catch (err: any) {
        console.error("Upload error:", err);
        res
          .status(500)
          .json({ success: false, message: err.message || "Upload failed" });
      }
    },
  );

  // 6. Dashboard Message Sender
  router.post(
    "/send",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode || req.body.clientCode;
        const {
          conversationId,
          to,
          text,
          mediaUrl,
          mediaType,
          templateName,
          templateLanguage = "en_US",
          variables = [],
          userId = "admin",
          replyToId = null,
          context = null,
        } = req.body;

        if (!conversationId && !to) {
          return res.status(400).json({
            success: false,
            message: "Missing conversationId or to phone number",
          });
        }

        let targetConvId = conversationId;

        if (!targetConvId && to) {
          const tenantConn = await getTenantConnection(clientCode);
          const ConversationModel = getTenantModel<IConversation>(
            tenantConn,
            "Conversation",
            schemas.conversations,
          );
          let conv = await ConversationModel.findOne({ phone: to });
          if (!conv) {
            // Attempt to find lead for name resolution
            const { getCrmModels } =
              await import("../../../lib/tenant/get.crm.model.ts");
            const { Lead } = await getCrmModels(clientCode);
            const lead = await Lead.findOne({ phone: to, clientCode }).lean();

            let resolvedName = "Customer";
            if (lead) {
              resolvedName = [lead.firstName, lead.lastName]
                .filter(Boolean)
                .join(" ");
            }

            conv = await ConversationModel.create({
              phone: to,
              userName: resolvedName || "Customer",
              status: "open",
              channel: "whatsapp",
              unreadCount: 0,
            });
          }
          targetConvId = conv._id;
        }

        const message = await whatsappService.sendOutboundMessage(
          clientCode,
          targetConvId,
          text,
          mediaUrl,
          mediaType,
          userId,
          templateName,
          templateLanguage,
          variables,
          replyToId,
          context,
        );

        res.json({ success: true, data: { message } });
      } catch (err: any) {
        console.error("❌ Outgoing Chat Error:", err);
        res.status(500).json({ success: false, message: err.message });
      }
    },
  );

  // 7. Toggle Message Star Status
  router.post(
    "/messages/:messageId/star",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { messageId } = req.params;
        const { isStarred } = req.body;

        const conn = await getTenantConnection(clientCode);
        const MessageModel = getTenantModel<IMessage>(
          conn,
          "Message",
          schemas.messages,
        );

        const message = await MessageModel.findById(messageId as string);
        if (!message) {
          return res
            .status(404)
            .json({ success: false, message: "Message not found" });
        }

        message.isStarred =
          typeof isStarred === "boolean" ? isStarred : !message.isStarred;
        await message.save();

        if (io) {
          io.to(clientCode).emit("message_updated", {
            messageId: message._id,
            conversationId: message.conversationId,
            updates: { isStarred: message.isStarred },
          });
        }

        res.json({ success: true, data: { isStarred: message.isStarred } });
      } catch (err: any) {
        console.error("Error toggling star:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to toggle star",
        });
      }
    },
  );

  // 8. React to Message
  router.post(
    "/messages/:messageId/react",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { messageId } = req.params;
        const { reaction } = req.body;

        const result = await whatsappService.sendReaction(
          clientCode,
          messageId as string,
          reaction,
        );
        res.json({ success: true, data: result });
      } catch (err: any) {
        console.error("Error reacting to message:", err);
        res
          .status(500)
          .json({ success: false, message: err.message || "Failed to react" });
      }
    },
  );

  // 9. Create Broadcast Campaign
  router.post(
    "/broadcast",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const {
          name,
          templateName,
          templateLanguage = "en_US",
          recipients = [], // List of { phone: string, variables: string[] }
        } = req.body;

        if (!templateName || !recipients.length) {
          return res.status(400).json({
            success: false,
            message: "Missing templateName or recipients",
          });
        }

        const conn = await getTenantConnection(clientCode);
        const BroadcastModel = getTenantModel(
          conn,
          "Broadcast",
          schemas.broadcasts,
        );
        const TemplateModel = getTenantModel(
          conn,
          "Template",
          schemas.templates,
        );

        const template = await TemplateModel.findOne({
          name: templateName,
          language: templateLanguage,
        });
        if (!template) {
          return res
            .status(404)
            .json({ success: false, message: "Template not found" });
        }

        const broadcast = await BroadcastModel.create({
          name: name || `Broadcast ${new Date().toLocaleString()}`,
          templateId: template._id,
          status: "processing",
          totalRecipients: recipients.length,
          sentCount: 0,
          failedCount: 0,
        });

        // Enqueue jobs
        const { crmQueue } = await import("../../../jobs/saas/crmWorker.ts");

        for (const recipient of recipients) {
          await crmQueue.add({
            clientCode,
            type: "crm.whatsapp_broadcast",
            payload: {
              broadcastId: broadcast._id.toString(),
              phone: recipient.phone,
              templateName,
              templateLanguage,
              variables: recipient.variables || [],
            },
          });
        }

        res.json({ success: true, data: broadcast });
      } catch (err: any) {
        console.error("Broadcast creation error:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to create broadcast",
        });
      }
    },
  );

  // 10. List Broadcasts
  router.get(
    "/broadcasts",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const conn = await getTenantConnection(clientCode);
        const BroadcastModel = getTenantModel(
          conn,
          "Broadcast",
          schemas.broadcasts,
        );

        const broadcasts = await BroadcastModel.find({}).sort({
          createdAt: -1,
        });
        res.json({ success: true, data: broadcasts });
      } catch (err: any) {
        console.error("Error fetching broadcasts:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to fetch broadcasts",
        });
      }
    },
  );

  return router;
};
