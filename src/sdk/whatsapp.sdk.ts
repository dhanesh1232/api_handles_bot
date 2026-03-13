/**
 * WhatsAppSDK
 *
 * Class facade over the createWhatsappService() factory.
 * Pass the socket.io instance at construction; clientCode stays bound.
 *
 * @example
 *   const whatsapp = new WhatsAppSDK(clientCode, io);
 *   await whatsapp.sendTemplate(convId, "welcome_msg", undefined, undefined, "system", { lead });
 *   await whatsapp.send(convId, "Hello from the team!");
 */

import type { Server } from "socket.io";
import { createWhatsappService } from "@/services/saas/whatsapp/whatsapp.service";

export class WhatsAppSDK {
  private readonly svc: ReturnType<typeof createWhatsappService>;

  constructor(
    private readonly clientCode: string,
    io: Server | null,
  ) {
    this.svc = createWhatsappService(io);
  }

  // ── Inbound webhook handlers ───────────────────────────────────────────────

  /**
   * Handle an inbound WhatsApp message from the webhook.
   * Auto-creates a lead if one doesn't exist for the sender's phone.
   */
  handleIncoming(
    messagePayload: any,
    from: string,
    msgBody: string,
    contacts: any,
  ): Promise<void> {
    return this.svc.handleIncomingMessage(
      this.clientCode,
      messagePayload,
      from,
      msgBody,
      contacts,
    );
  }

  /**
   * Handle a status update webhook (sent → delivered → read / failed).
   * Guards against priority regression (e.g. delivered can't go back to sent).
   */
  handleStatus(statusPayload: any): Promise<void> {
    return this.svc.handleStatusUpdate(this.clientCode, statusPayload);
  }

  // ── Outbound messaging ────────────────────────────────────────────────────

  /**
   * Send a plain text or media message to an existing conversation.
   *
   * @param conversationId - MongoDB _id of the Conversation document
   * @param text           - Message body text
   * @param mediaUrl       - Public URL of an image/video/document
   * @param mediaType      - "image" | "video" | "audio" | "document"
   * @param userId         - ID of the admin who sent it (default: "admin")
   * @param replyToId      - Message _id to thread-reply to
   * @param metadata       - Extra metadata attached to the Message document
   */
  send(
    conversationId: string,
    text?: string,
    mediaUrl?: string,
    mediaType?: string,
    userId = "admin",
    replyToId: string | null = null,
    metadata?: Record<string, any>,
  ) {
    return this.svc.sendOutboundMessage(
      this.clientCode,
      conversationId,
      text,
      mediaUrl,
      mediaType,
      userId,
      undefined, // templateName
      "en_US", // templateLanguage
      [], // variables
      replyToId,
      metadata,
    );
  }

  /**
   * Send a pre-approved WhatsApp template message.
   * Variables and language are resolved automatically via the stored
   * template mapping; pass raw overrides only if needed.
   *
   * @param conversationId  - MongoDB _id of the Conversation document
   * @param templateName    - Exact template name as registered in WhatsApp Business
   * @param language        - BCP-47 language code (default "en_US")
   * @param variables       - Ordered variable values (overrides auto-resolution)
   * @param userId          - Sender identity (default "system")
   * @param metadata        - Lead / event context for variable auto-resolution
   */
  sendTemplate(
    conversationId: string,
    templateName: string,
    language = "en_US",
    variables: string[] = [],
    userId = "system",
    metadata?: Record<string, any>,
  ) {
    return this.svc.sendOutboundMessage(
      this.clientCode,
      conversationId,
      undefined, // text
      undefined, // mediaUrl
      undefined, // mediaType
      userId,
      templateName,
      language,
      variables,
      null, // replyToId
      metadata,
    );
  }

  /**
   * Send or remove an emoji reaction on a specific message.
   * Pass an empty string for `emoji` to un-react.
   *
   * @param messageId - MongoDB _id of the Message to react to
   * @param emoji     - Emoji string, e.g. "👍" — pass "" to remove
   */
  sendReaction(
    messageId: string,
    emoji: string,
  ): Promise<{ success: boolean }> {
    return this.svc.sendReaction(this.clientCode, messageId, emoji);
  }
}
