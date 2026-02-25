import mongoose, { type Document } from "mongoose";

export interface IMessageReaction {
  emoji: string;
  reactBy: string; // 'admin' or contact phone
}

export interface IMessageTemplateData {
  name: string;
  language: string;
  headerType?: string;
  footer?: string;
  buttons?: any;
  variables?: string[];
}

export interface IMessageStatusHistory {
  status: string;
  timestamp: Date;
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  direction: "inbound" | "outbound";
  messageType: "text" | "image" | "document" | "template" | "video" | "audio";
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  caption?: string;
  whatsappMessageId?: string;
  sentBy: string; // 'admin', user_id, or system
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  error?: string;
  isStarred: boolean;
  replyTo?: mongoose.Types.ObjectId;
  replyToWhatsappId?: string;
  reactions: IMessageReaction[];
  statusHistory: IMessageStatusHistory[];
  templateData?: IMessageTemplateData;
  createdAt: Date;
  updatedAt: Date;
}

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
