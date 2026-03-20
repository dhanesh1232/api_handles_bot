import { getCrmModels } from "@lib/tenant/crm.models";
import { OpenAI } from "openai";
import { logger } from "@/lib/logger";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates an AI-powered summary of a lead's recent conversation history.
 *
 * **WORKING PROCESS:**
 * 1. Data Retrieval: Fetches the lead's profile and the last 50 messages across all linked conversations.
 * 2. Normalization: Reverses the message order (chronological) and formats into a "Lead: ... / Agent: ..." transcript.
 * 3. AI Orchestration: Dispatches the transcript to OpenAI's `gpt-4o-mini` with a specialized system prompt.
 * 4. Refinement: Temperature is set to 0.5 to balance creativity and factual accuracy.
 * 5. Persistence: Returns the summary string to be saved in the lead's document.
 *
 * **EDGE CASES:**
 * - No History: Returns a "No conversation history found" string if the lead hasn't messaged yet.
 * - OpenAI Downtime: Catches API errors and returns a graceful failure message.
 * - Token Limits: Limits input to 50 messages to prevent excessive cost or context window overflow.
 *
 * @param {string} clientCode - Tenant's unique identifier.
 * @param {string} leadId - The lead to summarize.
 * @returns {Promise<string>} The generated summary or an error string.
 */
export async function generateConversationSummary(
  clientCode: string,
  leadId: string,
): Promise<string> {
  try {
    const { Message, Lead } = await getCrmModels(clientCode);

    // 1. Get Lead context
    const lead = await Lead.findById(leadId);
    if (!lead) throw new Error("Lead not found");

    // 2. Fetch last 50 messages
    const messages = await Message.find({
      conversationId: { $in: await getConversationIds(clientCode, lead.phone) },
    })
      .sort({ createdAt: -1 })
      .limit(50);

    if (messages.length === 0) {
      return "No conversation history found to summarize.";
    }

    // 3. Format history for LLM
    const history = messages
      .reverse()
      .map((m) => {
        const role = m.direction === "inbound" ? "Lead" : "Agent";
        return `${role}: ${m.text || "[Media/Other]"}`;
      })
      .join("\n");

    // 4. Call LLM
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a helpful CRM assistant. Summarize the following WhatsApp conversation between an Agent and a Lead (${lead.firstName}). 
          Focus on:
          - The lead's primary interest or intent.
          - Key questions or pain points raised.
          - Any agreed-upon next steps or follow-ups.
          Keep it professional, concise, and under 150 words.`,
        },
        {
          role: "user",
          content: history,
        },
      ],
      temperature: 0.5,
    });

    return (
      response.choices[0]?.message?.content || "Failed to generate summary."
    );
  } catch (err: any) {
    logger.error(
      err,
      `[AI Service] Failed to generate summary for lead ${leadId}`,
    );
    return "Summary generation failed due to an internal error.";
  }
}

/**
 * Helper to find conversation IDs for a lead's phone
 */
async function getConversationIds(clientCode: string, phone: string) {
  const { Conversation } = await getCrmModels(clientCode);
  const convs = await Conversation.find({ phone }, "_id");
  return convs.map((c) => c._id);
}
