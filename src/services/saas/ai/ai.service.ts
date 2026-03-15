import { getCrmModels } from "@lib/tenant/crm.models";
import { OpenAI } from "openai";
import { logger } from "@/lib/logger";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Summarizes a conversation history using AI.
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
