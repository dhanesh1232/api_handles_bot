import axios, { type AxiosError } from "axios";

/**
 * Dispatches a raw text message via the Meta Cloud API.
 *
 * @param phoneId - Meta Business Phone Number ID.
 * @param token - Business Access Token.
 * @param to - Recipient number with country code.
 * @param message - The raw text payload.
 *
 * **DETAILED EXECUTION:**
 * 1. **Endpoint Resolution**: Constructs the Graph API v24.0 URL for the specific `phoneId`.
 * 2. **Payload Marshalling**: Wraps the text in the mandatory `messaging_product: "whatsapp"` structure.
 * 3. **API Dispatch**: Executes a POST request via `axios` with the Bearer token.
 */
export async function sendWhatsAppMessage(
  phoneId: string,
  token: string,
  to: string,
  message: string,
): Promise<WhatsAppResponse> {
  try {
    const url = `https://graph.facebook.com/v24.0/${phoneId}/messages`;

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
 * Sends a pre-approved WhatsApp Template message. Use this for pro-active messaging outside the 24h window.
 *
 * @param phoneId - Meta Business Phone Number ID.
 * @param components - Array of template parameters (header, body, buttons).
 *
 * **DETAILED EXECUTION:**
 * 1. **Template Mapping**: Instructs Meta to resolve the template by `name` and `language.code`.
 * 2. **Component Injection**: Passes the `variables` array as Meta-compliant components.
 *
 * **EDGE CASE MANAGEMENT:**
 * - API Rejection: Captures 4xx errors (e.g., Template Not Found, Rate Limited) and returns them in the `WhatsAppResponse` wrapper for graceful UI feedback.
 */
export async function sendWhatsAppTemplate(
  phoneId: string,
  token: string,
  to: string,
  templateName: string,
  components: any[] = [],
): Promise<WhatsAppResponse> {
  try {
    const url = `https://graph.facebook.com/v24.0/${phoneId}/messages`;
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
