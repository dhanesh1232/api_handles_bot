import express from "express";
import multer from "multer";
import { optimizeAndUploadMedia } from "../../../services/saas/mediaService.js";
import { ClientSecrets } from "../../../model/clients/secrets.js";
import { dbConnect } from "../../../lib/config.js";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.js";
import { Message, schemas } from "../../../model/saas/tenantSchemas.js";
import { validateClientKey } from "../../../middleware/saasAuth.js";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsappService.js";
import { GetURI, tenantDBConnect } from "../../../lib/tenant/connection.js";

const upload = multer({ storage: multer.memoryStorage() });

export const createChatRouter = (io) => {
  const router = express.Router();
  const whatsappService = createWhatsappService(io); // Helper instance

  // 1. List Conversations
  router.get("/conversations", validateClientKey, async (req, res) => {
    try {
      const { clientCode } = req;
      const uri = await GetURI(clientCode);
      const conn = await tenantDBConnect(uri);
      const ConversationModel =
        conn.models["Conversation"] ||
        conn.model("Conversation", schemas.conversations);

      const conversations = await ConversationModel.find({}).sort({
        lastMessageAt: -1,
      });
      // console.log(conversations);
      res.json(conversations);
    } catch (err) {
      console.error("Error fetching conversations:", err);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  });

  // 2. Get Messages for a Conversation
  router.get(
    "/conversations/:id/messages",
    validateClientKey,
    async (req, res) => {
      try {
        const { clientCode } = req;
        const { id } = req.params;

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const MessageModel =
          conn.models["Message"] || conn.model("Message", schemas.messages);

        const messages = await MessageModel.find({ conversationId: id })
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
    async (req, res) => {
      try {
        const { clientCode } = req;
        const { id } = req.params;

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const ConversationModel =
          conn.models["Conversation"] ||
          conn.model("Conversation", schemas.conversations);

        await ConversationModel.updateOne(
          { _id: id },
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
  router.post("/conversations", validateClientKey, async (req, res) => {
    try {
      const { clientCode } = req;
      const { phone, name } = req.body;

      const uri = await GetURI(clientCode);
      const conn = await tenantDBConnect(uri);
      const ConversationModel =
        conn.models["Conversation"] ||
        conn.model("Conversation", schemas.conversations);

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
  });

  // 5. Upload Media to R2
  router.post(
    "/upload",
    validateClientKey,
    upload.single("file"),
    async (req, res) => {
      try {
        const { clientCode } = req;
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

        // Determine type for frontend
        let type = "document";
        if (result.mimeType.startsWith("image/")) type = "image";
        else if (result.mimeType.startsWith("video/")) type = "video";
        else if (result.mimeType.startsWith("audio/")) type = "audio";

        res.json({ url: result.url, type });
      } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ error: err.message || "Upload failed" });
      }
    },
  );

  /**
   * Dashboard Message Sender
   * Uses centralized Service
   */
  router.post("/send", validateClientKey, async (req, res) => {
    const clientCode = req.clientCode || req.body.clientCode;
    console.log("🚀 ~ clientCode:", clientCode);
    const {
      conversationId,
      to,
      text,
      mediaUrl,
      mediaType,
      templateName,
      templateLanguage = "en_US",
      variables = [],
      userId = "admin", // Default sender
      replyToId = null,
    } = req.body;

    try {
      if (!conversationId && !to) {
        return res
          .status(400)
          .json({ error: "Missing conversationId or to phone number" });
      }

      // If no conversationId, we might need to resolve it first or let service handle it?
      // Service expects conversationId. Let's resolve it here if needed.
      let targetConvId = conversationId;

      if (!targetConvId && to) {
        // Resolve conversation ID from phone
        const tenantConn = await getTenantConnection(clientCode);
        const ConversationModel = getTenantModel(
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
    } catch (err) {
      console.error("❌ Outgoing Chat Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Toggle Message Star Status
  router.post(
    "/messages/:messageId/star",
    validateClientKey,
    async (req, res) => {
      try {
        const { clientCode } = req;
        const { messageId } = req.params;
        const { isStarred } = req.body;

        const uri = await GetURI(clientCode);
        const conn = await tenantDBConnect(uri);
        const MessageModel =
          conn.models["Message"] || conn.model("Message", schemas.messages);

        const message = await MessageModel.findById(messageId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }

        message.isStarred =
          typeof isStarred === "boolean" ? isStarred : !message.isStarred;
        await message.save();

        // Emit socket event for real-time update
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

  // 7. React to Message
  router.post(
    "/messages/:messageId/react",
    validateClientKey,
    async (req, res) => {
      try {
        const { clientCode } = req;
        const { messageId } = req.params;
        const { reaction } = req.body;

        const result = await whatsappService.sendReaction(
          clientCode,
          messageId,
          reaction,
        );
        res.json(result);
      } catch (err) {
        console.error("Error reacting to message:", err);
        res.status(500).json({ error: err.message || "Failed to react" });
      }
    },
  );

  return router;
};
