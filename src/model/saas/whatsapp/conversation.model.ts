import mongoose, { type Document } from "mongoose";

export interface IConversation extends Document {
  leadId?: mongoose.Types.ObjectId;
  channel: "whatsapp";
  phone: string;
  userName?: string;
  profilePicture?: string;
  lastMessage?: string;
  lastMessageId?: mongoose.Types.ObjectId;
  lastMessageStatus?: string;
  lastMessageSender: "admin" | "user";
  lastMessageType:
    | "text"
    | "image"
    | "document"
    | "template"
    | "video"
    | "audio";
  lastMessageAt?: Date;
  unreadCount: number;
  status: "open" | "closed";
  lastUserMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

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
      enum: ["text", "image", "document", "template", "video", "audio"],
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
