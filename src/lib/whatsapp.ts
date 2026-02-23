import axios, { type AxiosError } from "axios";

export interface WhatsAppResponse {
  success: boolean;
  data?: any;
  error?: any;
}

/**
 * Sends a WhatsApp message using Meta Cloud API.
 *
 * @param phoneId - Meta Phone Number ID
 * @param token - Meta Permanent Access Token
 * @param to - Recipient WhatsApp ID (phone number)
 * @param message - Text body
 */
export async function sendWhatsAppMessage(
  phoneId: string,
  token: string,
  to: string,
  message: string,
): Promise<WhatsAppResponse> {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

    const response = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return { success: true, data: response.data };
  } catch (err: unknown) {
    const error = err as AxiosError;
    console.error(
      "❌ WhatsApp Send Error:",
      error.response?.data || error.message,
    );
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * Sends a WhatsApp Template message.
 *
 * @param phoneId
 * @param token
 * @param to
 * @param templateName
 * @param components - Template parameters
 */
export async function sendWhatsAppTemplate(
  phoneId: string,
  token: string,
  to: string,
  templateName: string,
  components: any[] = [],
): Promise<WhatsAppResponse> {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: components,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    return { success: true, data: response.data };
  } catch (err: unknown) {
    const error = err as AxiosError;
    console.error(
      "❌ WhatsApp Template Error:",
      error.response?.data || error.message,
    );
    return { success: false, error: error.response?.data || error.message };
  }
}
