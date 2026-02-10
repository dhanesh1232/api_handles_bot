import axios from "axios";

/**
 * Sends a WhatsApp message using Meta Cloud API.
 *
 * @param {string} phoneId - Meta Phone Number ID
 * @param {string} token - Meta Permanent Access Token
 * @param {string} to - Recipient WhatsApp ID (phone number)
 * @param {string} message - Text body
 */
export async function sendWhatsAppMessage(phoneId, token, to, message) {
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
  } catch (err) {
    console.error("❌ WhatsApp Send Error:", err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Sends a WhatsApp Template message.
 *
 * @param {string} phoneId
 * @param {string} token
 * @param {string} to
 * @param {string} templateName
 * @param {array} components - Template parameters
 */
export async function sendWhatsAppTemplate(
  phoneId,
  token,
  to,
  templateName,
  components = [],
) {
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
  } catch (err) {
    console.error(
      "❌ WhatsApp Template Error:",
      err.response?.data || err.message,
    );
    return { success: false, error: err.response?.data || err.message };
  }
}
