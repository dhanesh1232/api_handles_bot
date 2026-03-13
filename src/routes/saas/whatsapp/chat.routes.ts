import express, { type Request, type Response } from "express";
import multer from "multer";
import { Server } from "socket.io";
import { dbConnect } from "../../../lib/config.ts";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";

import { validateClientKey } from "../../../middleware/saasAuth.ts";
import { ClientSecrets } from "../../../model/clients/secrets.ts";

import { optimizeAndUploadMedia } from "../../../services/saas/media/media.service.ts";
import { createSDK } from "../../../sdk/index.ts";

const upload = multer({ storage: multer.memoryStorage() });

export interface SaasRequest extends Request {
  clientCode: string;
  user?: any;
}

export const createChatRouter = (io: Server) => {
  const router = express.Router();

  // 1. List Conversations
  router.get(
    "/conversations",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { Conversation: ConversationModel } =
          await getCrmModels(clientCode);

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

        const { Message: MessageModel } = await getCrmModels(clientCode);

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

        const { Conversation: ConversationModel } =
          await getCrmModels(clientCode);

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

        const { Conversation: ConversationModel, Lead } =
          await getCrmModels(clientCode);

        let conversation = await ConversationModel.findOne({ phone });
        if (!conversation) {
          // Attempt to find lead for a better name

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

        const { Conversation: ConversationModel, Message: MessageModel } =
          await getCrmModels(clientCode);

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

  // 4b. Bulk Delete Conversations
  router.post(
    "/conversations/bulk-delete",
    validateClientKey,
    async (req: Request, res: Response) => {
      try {
        const sReq = req as SaasRequest;
        const clientCode = sReq.clientCode!;
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid or empty IDs" });
        }

        const { Conversation: ConversationModel, Message: MessageModel } =
          await getCrmModels(clientCode);

        await MessageModel.deleteMany({ conversationId: { $in: ids } });
        await ConversationModel.deleteMany({ _id: { $in: ids } });

        for (const id of ids) {
          io.to(clientCode).emit("conversation_deleted", {
            conversationId: id,
          });
        }

        res.json({ success: true });
      } catch (err: any) {
        console.error("Error bulk deleting conversations:", err);
        res.status(500).json({
          success: false,
          message: err.message || "Failed to bulk delete conversations",
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
          const { Conversation: ConversationModel, Lead } =
            await getCrmModels(clientCode);

          let conv = await ConversationModel.findOne({ phone: to });
          if (!conv) {
            // Attempt to find lead for name resolution

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

        const sdk = createSDK(clientCode, io);
        const message = templateName
          ? await sdk.whatsapp.sendTemplate(
              targetConvId,
              templateName,
              templateLanguage,
              variables,
              userId,
              context ?? undefined,
            )
          : await sdk.whatsapp.send(
              targetConvId,
              text,
              mediaUrl,
              mediaType,
              userId,
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

        const { Message: MessageModel } = await getCrmModels(clientCode);
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

        const sdk = createSDK(clientCode, io);
        const result = await sdk.whatsapp.sendReaction(
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
        let {
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

        const { Broadcast: BroadcastModel, Template: TemplateModel } =
          await getCrmModels(clientCode);

        let template = await TemplateModel.findOne({
          name: templateName,
          language: templateLanguage,
        });

        // Fallback: if en_US fails, try to find any template with that name to get the correct language
        if (!template && templateLanguage === "en_US") {
          template = await TemplateModel.findOne({ name: templateName });
          if (template) {
            console.log(
              `[Broadcast] Redirecting en_US to resolved language: ${template.language}`,
            );
            templateLanguage = template.language;
          }
        }

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
        const { Broadcast: BroadcastModel } = await getCrmModels(clientCode);

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
