import mongoose, { type Document, type Model } from "mongoose";

export interface ITemplateButton {
  type: "URL" | "PHONE_NUMBER" | "QUICK_REPLY";
  text?: string;
  url?: string;
  phoneNumber?: string;
}

export interface ITemplate extends Document {
  name: string;
  language: string;
  channel: "whatsapp" | "email";
  status: string;
  headerType?: "NONE" | "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT";
  bodyText: string;
  subject?: string;
  attachments?: string[];
  variablesCount?: number;
  footerText?: string;
  buttons?: ITemplateButton[];
  components?: any[];
  createdAt: Date;
  updatedAt: Date;
}

export const TemplateSchema = new mongoose.Schema<ITemplate>(
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
    channel: {
      type: String,
      enum: ["whatsapp", "email"],
      default: "whatsapp",
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    headerType: {
      type: String,
      enum: ["NONE", "IMAGE", "VIDEO", "DOCUMENT", "TEXT"],
      default: "NONE",
    },
    subject: {
      type: String,
      trim: true,
    },
    bodyText: {
      type: String,
      required: true,
    },
    attachments: [
      {
        type: String,
      },
    ],
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

// Unique index on name + language + channel
TemplateSchema.index({ name: 1, language: 1, channel: 1 }, { unique: true });

// ─── Model ────────────────────────────────────────────────────────────────────

export default TemplateSchema;
