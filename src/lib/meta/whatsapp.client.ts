/**
 * lib/meta/whatsapp.client.ts
 *
 * Thin, typed HTTP client for the Meta (WhatsApp Business) Cloud API.
 * Holds token + phoneNumberId once; every method on this class can use them
 * without the caller passing credentials on every call.
 *
 * Usage:
 *   const client = MetaWhatsAppClient.fromSecrets(secrets);
 *   await client.sendText(to, "Hello!");
 *   await client.sendTemplate(to, "welcome", "en", ["John"]);
 *   const templates = await client.getTemplates(businessId);
 *
 * This class is intentionally NOT a singleton — each tenant gets their own
 * instance with their own token. Use MetaWhatsAppClient.fromSecrets(secrets)
 * to create one from a ClientSecrets document.
 */

import axios, { type AxiosInstance } from "axios";
import { logger } from "@lib/logger";

// ─── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://graph.facebook.com/v21.0";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MetaTextPayload {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string };
}

export interface MetaTemplatePayload {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: MetaTemplateComponent[];
  };
}

export interface MetaTemplateComponent {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
}

export interface MetaMediaPayload {
  messaging_product: "whatsapp";
  to: string;
  type: "image" | "video" | "document" | "audio";
  [key: string]: unknown;
}

export interface MetaReactionPayload {
  messaging_product: "whatsapp";
  to: string;
  type: "reaction";
  reaction: { message_id: string; emoji: string };
}

export interface MetaSendResult {
  messages: Array<{ id: string }>;
  contacts: Array<{ input: string; wa_id: string }>;
}

export interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: unknown[];
}

// ─── Client Class ──────────────────────────────────────────────────────────────

export class MetaWhatsAppClient {
  private readonly http: AxiosInstance;
  private readonly log = logger.child({ module: "MetaWhatsAppClient" });

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
  ) {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  // ─── Factory ───────────────────────────────────────────────────────────────

  /**
   * Build a client from a ClientSecrets document.
   * Throws if credentials are missing.
   */
  static fromSecrets(secrets: {
    getDecrypted: (key: string) => string | null | undefined;
    clientCode?: string;
  }): MetaWhatsAppClient {
    const token = secrets.getDecrypted("whatsappToken");
    const phoneNumberId = secrets.getDecrypted("whatsappPhoneNumberId");

    if (!token || !phoneNumberId) {
      throw new Error(
        `Missing WhatsApp credentials for client${secrets.clientCode ? ` [${secrets.clientCode}]` : ""}`,
      );
    }

    return new MetaWhatsAppClient(token, phoneNumberId);
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  /** Send a plain text message. */
  async sendText(to: string, body: string): Promise<MetaSendResult> {
    return this.send<MetaSendResult>({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    });
  }

  /**
   * Send a template message with optional variable components.
   *
   * @param to          Recipient phone in E.164 format
   * @param name        Approved template name
   * @param language    Template language code (e.g. "en", "en_US")
   * @param variables   Body variable values (positional)
   */
  async sendTemplate(
    to: string,
    name: string,
    language = "en",
    variables: string[] = [],
  ): Promise<MetaSendResult> {
    const components: MetaTemplateComponent[] =
      variables.length > 0
        ? [
            {
              type: "body",
              parameters: variables.map((v) => ({ type: "text", text: v })),
            },
          ]
        : [];

    return this.send<MetaSendResult>({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(components.length > 0 && { components }),
      },
    });
  }

  /** Send a reaction to a specific message. */
  async sendReaction(
    to: string,
    messageId: string,
    emoji: string,
  ): Promise<MetaSendResult> {
    return this.send<MetaSendResult>({
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
  }

  /** Mark a message as read. */
  async markRead(messageId: string): Promise<void> {
    await this.send({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  /** Send a media message (image, video, document, audio). */
  async sendMedia(
    to: string,
    type: "image" | "video" | "document" | "audio",
    mediaUrl: string,
    caption?: string,
  ): Promise<MetaSendResult> {
    return this.send<MetaSendResult>({
      messaging_product: "whatsapp",
      to,
      type,
      [type]: {
        link: mediaUrl,
        ...(caption && { caption }),
      },
    });
  }

  // ─── Media download ────────────────────────────────────────────────────────

  /**
   * Resolve a media ID to a download URL + MIME type.
   * Returns null if the lookup fails instead of throwing.
   */
  async resolveMediaUrl(
    mediaId: string,
  ): Promise<{ url: string; mimeType: string } | null> {
    try {
      const { data } = await this.http.get<{ url: string; mime_type: string }>(
        `/${mediaId}`,
      );
      return { url: data.url, mimeType: data.mime_type };
    } catch (err) {
      this.log.warn({ err, mediaId }, "Failed to resolve media URL");
      return null;
    }
  }

  /**
   * Download a media file by URL (using the same auth token).
   * Returns a Buffer, or null on failure.
   */
  async downloadMedia(url: string): Promise<Buffer | null> {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return Buffer.from(response.data);
    } catch (err) {
      this.log.warn({ err }, "Failed to download media");
      return null;
    }
  }

  // ─── Template management ───────────────────────────────────────────────────

  /**
   * Fetch all approved templates from the Business Account.
   * @param businessId  WhatsApp Business Account ID
   */
  async getTemplates(businessId: string): Promise<MetaTemplate[]> {
    const { data } = await this.http.get<{ data: MetaTemplate[] }>(
      `/${businessId}/message_templates`,
      { params: { limit: 250 } },
    );
    return data.data ?? [];
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async send<T>(payload: Record<string, unknown>): Promise<T> {
    try {
      const { data } = await this.http.post<T>(
        `/${this.phoneNumberId}/messages`,
        payload,
      );
      return data;
    } catch (err: any) {
      const detail = err.response?.data?.error ?? err.message;
      this.log.error(
        { err: detail, phoneNumberId: this.phoneNumberId },
        "Meta API send failed",
      );
      throw err;
    }
  }
}
