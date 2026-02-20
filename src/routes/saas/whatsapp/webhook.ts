import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { dbConnect } from "../../../lib/config.js";
import { ClientSecrets } from "../../../model/clients/secrets.js";
import { createWhatsappService } from "../../../services/saas/whatsapp/whatsappService.ts";

export const createWebhookRouter = async (io: Server) => {
  await dbConnect("services");
  const router = express.Router();
  const whatsappService = createWhatsappService(io);

  /**
   * WhatsApp Webhook Verification (Meta Cloud API)
   */
  router.get("/webhook", async (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"];

    const allSecrets = await ClientSecrets.find({});

    console.log(`🔍 Verifying Webhook. Incoming: ${token}`);

    const secrets = allSecrets.find((s: any) => {
      const stored = s.getDecrypted("whatsappWebhookToken");
      return stored && stored.trim() === token;
    });

    if (mode === "subscribe" && secrets) {
      console.log(
        `✅ WhatsApp Webhook Verified for client: ${secrets.clientCode}`,
      );
      return res.status(200).send(challenge);
    } else {
      console.warn("❌ Webhook Verification Failed. Token mismatch.");
    }

    res.status(403).send("Verification failed");
  });

  /**
   * WhatsApp Webhook Message Handler
   */
  router.post("/webhook", async (req: Request, res: Response) => {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      res.sendStatus(200); // Verify receipt immediately

      setImmediate(async () => {
        try {
          if (body.entry && body.entry.length > 0) {
            const allSecrets = await ClientSecrets.find({});

            for (const entry of body.entry) {
              const changes = entry.changes;
              if (changes && changes.length > 0) {
                for (const change of changes) {
                  const value = change.value;
                  const metadata = value?.metadata;

                  if (!metadata) continue;

                  const phoneId = String(metadata.phone_number_id);

                  const secrets = allSecrets.find((s: any) => {
                    const storedPid = s.getDecrypted("whatsappPhoneNumberId");
                    return storedPid && String(storedPid) === phoneId;
                  });

                  if (!secrets) {
                    console.warn(
                      `⚠️ Webhook: Unknown Phone ID ${phoneId}. Skipping.`,
                    );
                    continue;
                  }

                  const clientCode = secrets.clientCode;
                  const contacts = value.contacts;

                  // 1. Handle Messages
                  if (value.messages && value.messages.length > 0) {
                    for (const message of value.messages) {
                      const from = message.from;
                      let msgBody = "Media";
                      if (message.type === "text") msgBody = message.text.body;
                      else if (message.type === "image")
                        msgBody = message.image?.caption || "Image";
                      else if (message.type === "document")
                        msgBody = message.document?.caption || "Document";
                      else if (message.type === "video")
                        msgBody = message.video?.caption || "Video";
                      else if (message.type === "interactive") {
                        const iType = message.interactive?.type;
                        if (iType === "button_reply")
                          msgBody = message.interactive.button_reply?.title;
                        else if (iType === "list_reply")
                          msgBody = message.interactive.list_reply?.title;
                      }

                      const contact = value.contacts?.find(
                        (c: any) => c.wa_id === from,
                      );

                      console.log(
                        `[${clientCode}] Incoming ${message.type} from ${from} | Meta TS: ${message.timestamp}`,
                      );

                      await whatsappService.handleIncomingMessage(
                        clientCode,
                        message,
                        from,
                        msgBody,
                        contact,
                      );
                    }
                  }

                  // 2. Handle Status Updates
                  if (value.statuses && value.statuses.length > 0) {
                    for (const status of value.statuses) {
                      console.log(
                        `📩 [${clientCode}] Status Update: ${status.status} for ${status.id}`,
                      );
                      await whatsappService.handleStatusUpdate(
                        clientCode,
                        status,
                      );
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("❌ Webhook Processing Error:", err);
        }
      });
    } else {
      res.sendStatus(404);
    }
  });

  return router;
};
