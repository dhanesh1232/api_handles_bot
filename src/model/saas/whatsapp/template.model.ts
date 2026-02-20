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
  status: "APPROVED";
  headerType: "NONE" | "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT";
  bodyText: string;
  variablesCount: number;
  footerText?: string;
  buttons: ITemplateButton[];
  components: any[];
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

const Template: Model<ITemplate> =
  mongoose.models.Template || mongoose.model<ITemplate>("Template", TemplateSchema);

export default Template;
