import express, { type Request, type Response } from "express";
import { Server } from "socket.io";
import { dbConnect } from "@/lib/config";
import { ClientSecrets } from "@/model/clients/secrets";
import { createSDK } from "@/sdk/index";

/**
 * @module Routes/WhatsApp/Webhook
 * @responsibility Real-time ingestion of Meta WhatsApp events.
 *
 * **GOAL:** Verify webhook endpoints and process incoming messages, status updates (delivered/read), and media events from Meta Cloud API.
 *
 * **DETAILED EXECUTION:**
 * 1. **Verification (GET)**: Performs a secure handshake with Meta using the tenant-specific `whatsappWebhookToken`.
 * 2. **Ingestion (POST)**: Receives encrypted batches of events, identifies the target tenant by `phoneNumberId`, and routes to the individual `whatsapp.handleIncoming()` logic.
 */
export const createWebhookRouter = async (io: Server) => {
  await dbConnect("services");
  const router = express.Router();

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
      return res.status(200).set("Content-Type", "text/plain").send(challenge);
    } else {
      console.warn(
        "❌ Webhook Verification Failed. Token mismatch or unknown mode.",
      );
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

            // Cache SDK instances per clientCode for this webhook batch
            const sdkCache = new Map<string, ReturnType<typeof createSDK>>();
            const getSDK = (code: string) => {
              if (!sdkCache.has(code)) sdkCache.set(code, createSDK(code, io));
              return sdkCache.get(code)!;
            };

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
                  const _contacts = value.contacts;

                  // 1. Handle Messages
                  if (value.messages && value.messages.length > 0) {
                    for (const message of value.messages) {
                      const from = message.from;
                      const mType = String(message.type || "text")
                        .trim()
                        .toLowerCase();
                      let msgBody = "Media";
                      if (mType === "text") msgBody = message.text?.body || "";
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

                      await getSDK(clientCode).whatsapp.handleIncoming(
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
                      await getSDK(clientCode).whatsapp.handleStatus(status);
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
