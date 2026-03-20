/**
 * @module Communication/ConversationModel
 * @responsibility Manages the aggregate state of a messaging thread between a Lead and the CRM.
 *
 * **SCHEMA DESIGN:**
 * - **Lead Correlation**: Tracks the `leadId` for lookups and `phone` for direct addressing.
 * - **State Hub**: maintains the "Last Known State" (last message text, status, timestamp, and sender type).
 * - **Engagement Metrics**: Tracks `unreadCount` and `lastUserMessageAt` to power the "Inbox" sorting and priority views.
 * - **Session Management**: Supports closing/re-opening conversations (status `open`/`closed`).
 *
 * **DETAILED EXECUTION:**
 * 1. **Lifecycle**: Created automatically by `handleIncomingMessage` or `sendOutboundMessage` if a thread doesn't exist for the phone.
 * 2. **Update Pattern**: Incremented on every inbound message; cleared (`unreadCount: 0`) when an agent views the thread.
 */
import mongoose from "mongoose";

export const ConversationSchema = new mongoose.Schema<IConversation>(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    channel: {
      type: String,
      enum: ["whatsapp"],
      default: "whatsapp",
    },
    phone: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
    },
    profilePicture: {
      type: String,
    },
    lastMessage: {
      type: String,
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageStatus: {
      type: String,
      default: "sent",
    },
    lastMessageSender: {
      type: String, // 'admin' or 'user'
      default: "user",
    },
    lastMessageType: {
      type: String,
      enum: [
        "text",
        "image",
        "document",
        "template",
        "video",
        "audio",
        "button",
        "interactive",
        "location",
        "contacts",
        "sticker",
        "reaction",
      ],
      default: "text",
    },
    lastMessageAt: {
      type: Date,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
    lastUserMessageAt: {
      type: Date,
    },
  },
  { timestamps: true, collection: "conversations" },
);

ConversationSchema.index({ leadId: 1 });
ConversationSchema.index({ phone: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export default ConversationSchema;
