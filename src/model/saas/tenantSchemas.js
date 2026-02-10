import mongoose from "mongoose";

/**
 * @ConversationSchema
 *
 * - leadId:
 * - channel: whatsapp
 * - phone:
 * - userName:
 * - lastMessage:
 * - lastMessageId:
 * - lastMessageStatus:
 * - lastMessageSender:
 * - lastMessageType:
 * - lastMessageAt:
 * - unreadCount:
 * - status:
 * - lastUserMessageAt:
 */

export const ConversationSchema = new mongoose.Schema(
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

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model("Conversation", ConversationSchema);

/**
 * @MessageSchema
 *
 * - conversationId:
 * - direction: inbound or outbound
 * - messageType: text, image, document, template, video, audio
 * - text:
 * - mediaUrl:
 * - whatsappMessageId:
 * - sentBy:
 * - status:
 * - error:
 * - isStarred:
 * - replyTo:
 * - replyToWhatsappId:
 */

export const MessageSchema = new mongoose.Schema(
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

export const Message =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);

/**
 * @TemplateSchema
 *
 * - name:
 * - language:
 * - status:
 * - headerType:
 * - bodyText:
 * - variablesCount:
 * - footerText:
 * - buttons:
 * - components:
 */

const TemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    language: {
      type: String,
      required: true,
      default: "en_US",
    },
    status: {
      type: String,
      required: true,
      enum: ["APPROVED"], // Only store APPROVED templates
    },
    headerType: {
      type: String,
      enum: ["NONE", "IMAGE", "VIDEO", "DOCUMENT", "TEXT"],
      default: "NONE",
    },
    bodyText: {
      type: String,
      required: true,
    },
    variablesCount: {
      type: Number,
      default: 0,
    },
    footerText: {
      type: String,
    },
    buttons: [
      {
        type: {
          type: String,
          enum: ["URL", "PHONE_NUMBER", "QUICK_REPLY"],
        },
        text: String,
        url: String,
        phoneNumber: String,
      },
    ],
    components: [], // Store raw Meta components for future-reference
  },
  { timestamps: true, collection: "templates" },
);

// Unique index on name + language
TemplateSchema.index({ name: 1, language: 1 }, { unique: true });

export const Template =
  mongoose.models.Template || mongoose.model("Template", TemplateSchema);

export const schemas = {
  conversations: ConversationSchema,
  messages: MessageSchema,
  templates: TemplateSchema,
};
