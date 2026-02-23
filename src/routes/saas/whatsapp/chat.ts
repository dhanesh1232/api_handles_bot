import express, { type Request, type Response } from "express";
import multer from "multer";
import { Server } from "socket.io";
import { dbConnect } from "../../../lib/config.js";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { GetURI, tenantDBConnect } from "../../../lib/tenant/connection.js";
import { validateClientKey } from "../../../middleware/saasAuth.js";
import { ClientSecrets } from "../../../model/clients/secrets.js";
import { schemas } from "../../../model/saas/tenantSchemas.js";
import type { IConversation } from "../../../model/saas/whatsapp/conversation.model.ts";
import type { IMessage } from "../../../model/saas/whatsapp/message.model.ts";
import { optimizeAndUploadMedia } from "../../../services/saas/mediaService.js";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsappService.ts";

const upload = multer({ storage: multer.memoryStorage() });

export interface SaasRequest extends Request {
  clientCode?: string;
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
        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );

        const conversations = await ConversationModel.find({}).sort({
          lastMessageAt: -1,
        });
        res.json(conversations);
      } catch (err) {
        console.error("Error fetching conversations:", err);
        res.status(500).json({ error: "Failed to fetch chats" });
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

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
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

        res.json(messages);
      } catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Failed to fetch messages" });
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

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
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
      } catch (err) {
        console.error("Error marking read:", err);
        res.status(500).json({ error: "Failed to mark as read" });
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

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const ConversationModel = getTenantModel<IConversation>(
          conn,
          "Conversation",
          schemas.conversations,
        );

        let conversation = await ConversationModel.findOne({ phone });
        if (!conversation) {
          conversation = await ConversationModel.create({
            phone,
            userName: name || "New Contact",
            status: "open",
            channel: "whatsapp",
            unreadCount: 0,
            lastMessageAt: new Date(),
          });
        }

        res.json(conversation);
      } catch (err) {
        console.error("Error creating chat:", err);
        res.status(500).json({ error: "Failed to create chat" });
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
          return res.status(400).json({ error: "No file provided" });
        }

        await dbConnect("services");
        const secrets = await ClientSecrets.findOne({ clientCode });

        if (!secrets) {
          return res.status(404).json({ error: "Client secrets not found" });
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

        res.json({ url: result.url, type });
      } catch (err: any) {
        console.error("Upload error:", err);
        res.status(500).json({ error: err.message || "Upload failed" });
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
        } = req.body;

        if (!conversationId && !to) {
          return res
            .status(400)
            .json({ error: "Missing conversationId or to phone number" });
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
            conv = await ConversationModel.create({
              phone: to,
              userName: "Customer",
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
        );

        res.json({ success: true, message });
      } catch (err: any) {
        console.error("❌ Outgoing Chat Error:", err);
        res.status(500).json({ error: err.message });
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

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const MessageModel = getTenantModel<IMessage>(
          conn,
          "Message",
          schemas.messages,
        );

        const message = await MessageModel.findById(messageId as string);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
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

        res.json({ success: true, isStarred: message.isStarred });
      } catch (err) {
        console.error("Error toggling star:", err);
        res.status(500).json({ error: "Failed to toggle star" });
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
        res.json(result);
      } catch (err: any) {
        console.error("Error reacting to message:", err);
        res.status(500).json({ error: err.message || "Failed to react" });
      }
    },
  );

  return router;
};
