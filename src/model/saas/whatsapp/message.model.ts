import mongoose, { type Document } from "mongoose";

export const MessageSchema = new mongoose.Schema<IMessage>(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
      index: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "document", "template", "video", "audio"],
      default: "text",
    },
    text: {
      type: String,
      trim: true,
    },
    mediaUrl: {
      type: String,
    },
    mediaType: {
      type: String,
    },
    caption: {
      type: String,
    },
    whatsappMessageId: {
      type: String,
    },
    sentBy: {
      type: String, // 'admin', user_id, or system
      default: "admin",
    },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "queued",
      index: true,
    },
    error: {
      type: String,
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    replyToWhatsappId: {
      type: String,
    },
    reactions: [
      {
        emoji: String,
        reactBy: String, // 'admin' or contact phone
      },
    ],
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    templateData: {
      name: String,
      language: String,
      headerType: String,
      footer: String,
      buttons: mongoose.Schema.Types.Mixed,
      variables: [String],
    },
  },
  { timestamps: true, collection: "messages" },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ whatsappMessageId: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export default MessageSchema;
