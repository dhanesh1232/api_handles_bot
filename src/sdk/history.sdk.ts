import mongoose from "mongoose";
import { getCrmModels } from "@/lib/tenant/crm.models";
import { BaseSDK } from "./base.sdk";

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  body?: string;
  timestamp: Date;
  performedBy: string;
  metadata?: any;
  source: "activity" | "note" | "message";
}

export class HistorySDK extends BaseSDK {
  /**
   * Get unified timeline for a lead.
   */
  async getTimeline(
    leadId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<TimelineEvent[]> {
    const { Lead, LeadActivity, LeadNote, Message, Conversation } =
      await getCrmModels(this.clientCode);
    const { limit = 50, offset = 0 } = options;

    const lead = await Lead.findById(leadId).select("phone").lean();
    if (!lead) throw new Error("Lead not found");

    // 1. Fetch activities
    const activities = await LeadActivity.find({
      leadId: new mongoose.Types.ObjectId(leadId),
      clientCode: this.clientCode,
    })
      .sort({ createdAt: -1 })
      .limit(limit + offset)
      .lean();

    // 2. Fetch notes
    const notes = await LeadNote.find({
      leadId: new mongoose.Types.ObjectId(leadId),
      clientCode: this.clientCode,
    })
      .sort({ createdAt: -1 })
      .limit(limit + offset)
      .lean();

    // 3. Fetch WhatsApp messages (linked by phone)
    let messages: any[] = [];
    const conversation = await Conversation.findOne({
      phone: lead.phone,
      clientCode: this.clientCode,
    })
      .select("_id")
      .lean();
    if (conversation) {
      messages = await Message.find({ conversationId: conversation._id })
        .sort({ createdAt: -1 })
        .limit(limit + offset)
        .lean();
    }

    // 4. Map to unified format
    const timeline: TimelineEvent[] = [
      ...activities.map((a: any) => ({
        id: a._id.toString(),
        type: a.type,
        title: a.title,
        body: a.body,
        timestamp: a.createdAt,
        performedBy: a.performedBy,
        metadata: a.metadata,
        source: "activity" as const,
      })),
      ...notes.map((n: any) => ({
        id: n._id.toString(),
        type: "note_added",
        title: "Note added",
        body: n.content,
        timestamp: n.createdAt,
        performedBy: n.createdBy,
        metadata: { isPinned: n.isPinned },
        source: "note" as const,
      })),
      ...messages.map((m: any) => ({
        id: m._id.toString(),
        type: m.direction === "inbound" ? "whatsapp_received" : "whatsapp_sent",
        title: m.direction === "inbound" ? "Message received" : "Message sent",
        body: m.text || (m.messageType !== "text" ? `[${m.messageType}]` : ""),
        timestamp: m.createdAt,
        performedBy: m.direction === "inbound" ? "user" : "admin",
        metadata: {
          status: m.status,
          messageType: m.messageType,
          mediaUrl: m.mediaUrl,
        },
        source: "message" as const,
      })),
    ];

    // 5. Sort by timestamp desc and slice
    return timeline
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(offset, offset + limit);
  }
}

const historySDKs: Record<string, HistorySDK> = {};

export const getHistorySDK = (clientCode: string) => {
  if (!historySDKs[clientCode]) {
    historySDKs[clientCode] = new HistorySDK(clientCode);
  }
  return historySDKs[clientCode];
};
