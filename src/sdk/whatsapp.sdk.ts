/**
 * @file whatsapp.sdk.ts
 * @module WhatsAppSDK
 * @responsibility Facade for the Meta WhatsApp Business API, handling both conversational messaging and template-based automation.
 * @dependencies whatsapp.service.ts
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
   * Processes a standard inbound message from a customer.
   *
   * @param {any} messagePayload - The raw Meta JSON block.
   * @param {string} from - Sender's international phone number.
   * @param {string} msgBody - Decrypted text content.
   * @param {any} contacts - Contact metadata (Profile name, etc.).
   * @returns {Promise<void>}
   *
   * **DETAILED EXECUTION:**
   * 1. **Lead Sync**: Resolves the Lead by phone; auto-creates if missing (Category: WhatsApp User).
   * 2. **Conversation Routing**: Ensures a `Conversation` hub exists for the thread.
   * 3. **Persistence**: Saves the message with its Meta ID to prevent duplicates.
   * 4. **Side-Effects**: Updates `unreadCount`, `lastMessageAt`, and bumps the Lead's activity timeline.
   * 5. **Real-time**: Emits to the tenant's socket room for frontend UI updates.
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
   * Orchestrates message status transitions (sent -> delivered -> read).
   *
   * **WORKING PROCESS:**
   * 1. Matches the Meta `whatsappId` to a local `Message` document.
   * 2. Guards against "status regression" (prevents a 'delivered' status from reverting to 'sent').
   * 3. Updates the `status` field and logs the timestamp.
   *
   * @param {any} statusPayload - Meta status webhook payload.
   * @returns {Promise<void>}
   */
  handleStatus(statusPayload: any): Promise<void> {
    return this.svc.handleStatusUpdate(this.clientCode, statusPayload);
  }

  // ── Outbound messaging ────────────────────────────────────────────────────

  /**
   * Dispatches a free-text or media message within an active 24-hour window.
   *
   * @param {string} conversationId - CRM conversation identifier.
   * @param {string} [text] - Text body.
   * @param {string} [mediaUrl] - Publicly accessible asset URL.
   * @param {string} [mediaType] - "image" | "video" | "audio" | "document".
   * @param {string} [userId="admin"] - Identity of the sending staff member.
   * @param {string} [replyToId] - ID of the message being replied to (threading).
   * @param {object} [metadata] - Operational context flags.
   * @param {string} [filename] - Display name for document attachments.
   *
   * **DETAILED EXECUTION:**
   * 1. **Quota Check**: Verifies the tenant has sufficient credits before dispatch.
   * 2. **Context Resolution**: Resolves the Meta Phone ID and access token for the tenant.
   * 3. **Media Orchestration**: Re-uploads external assets to Meta's servers if required.
   * 4. **API Dispatch**: Executes the Graph API request.
   * 5. **Logging**: Persists the message as `sent` (or `failed` if the API rejects it).
   */
  send(
    conversationId: string,
    text?: string,
    mediaUrl?: string,
    mediaType?: string,
    userId = "admin",
    replyToId: string | null = null,
    metadata?: Record<string, any>,
    filename?: string,
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
      filename,
    );
  }

  /**
   * Sends a pre-registered Meta template (required for starting conversations).
   *
   * **WORKING PROCESS:**
   * 1. Retrieves the template definition and mapping from the `Template` collection.
   * 2. Resolves dynamic variables using `metadata` (e.g., replaces `{{1}}` with lead name).
   * 3. Compiles the Meta component payload (HEADER, BODY, BUTTONS).
   * 4. Transmits to Meta and records the interactive message in CRM history.
   *
   * @param {string} conversationId - CRM conversation identifier.
   * @param {string} templateName - Name as defined in FB Business Manager.
   * @param {string} [language="en_US"] - BCP-47 locale.
   * @param {string[]} [variables=[]] - Explicit values (overrides auto-mapping).
   * @param {string} [userId="system"] - Identity for automation logs.
   * @param {object} [metadata] - Data object for auto-resolution logic.
   */
  sendTemplate(
    conversationId: string,
    templateName: string,
    language = "en_US",
    variables: string[] = [],
    userId = "system",
    metadata?: Record<string, any>,
    mediaUrl?: string,
    mediaType?: string,
    filename?: string,
  ) {
    return this.svc.sendOutboundMessage(
      this.clientCode,
      conversationId,
      undefined, // text
      mediaUrl,
      mediaType,
      userId,
      templateName,
      language,
      variables,
      null, // replyToId
      metadata,
      filename,
    );
  }

  /**
   * Sends or removes a reaction emoji on a received message.
   *
   * @param {string} messageId - The `_id` of the target Message.
   * @param {string} emoji - Emoji character or empty string to remove.
   * @returns {Promise<{ success: boolean }>}
   */
  sendReaction(
    messageId: string,
    emoji: string,
  ): Promise<{ success: boolean }> {
    return this.svc.sendReaction(this.clientCode, messageId, emoji);
  }
}
