import mongoose from "mongoose";

const VariableMappingSchema = new mongoose.Schema(
  {
    position: { type: Number, required: true },
    label: { type: String, required: true },
    source: {
      type: String,
      enum: ["crm", "static", "computed", "system", "manual", "trigger"],
      required: true,
    },
    collection: { type: String },
    field: { type: String },
    staticValue: { type: String },
    formula: { type: String },
    fallback: { type: String },
    required: { type: Boolean, default: false },

    // Component tracking
    componentType: {
      type: String,
      enum: ["HEADER", "BODY", "FOOTER", "BUTTON", "SUBJECT"],
    },

    componentIndex: { type: Number },
    originalIndex: { type: Number },
    transform: {
      type: String,
      enum: [
        "none",
        "uppercase",
        "lowercase",
        "titlecase",
        "date",
        "currency",
        "number",
      ],
      default: "none",
    },
  },
  { _id: false, suppressReservedKeysWarning: true },
);

export const TemplateSchema = new mongoose.Schema<ITemplate>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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

    // New Fields
    templateId: { type: String },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
    },
    headerText: { type: String },
    variablePositions: [{ type: Number }],
    variableMapping: [VariableMappingSchema],
    onEmptyVariable: {
      type: String,
      enum: ["skip_send", "use_fallback", "send_anyway"],
      default: "use_fallback",
    },
    contentType: {
      type: String,
      enum: ["text", "html"],
      default: "text",
    },
    mappingStatus: {
      type: String,
      enum: ["unmapped", "partial", "complete", "outdated"],
      default: "unmapped",
    },
    lastSyncedAt: { type: Date },
    lastMappingUpdatedAt: { type: Date },
    isActive: { type: Boolean, default: true },
    socialLinks: [
      {
        platform: {
          type: String,
          enum: ["facebook", "twitter", "instagram", "linkedin"],
        },
        url: String,
        active: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true, collection: "templates" },
);

// Unique index on name + language + channel
TemplateSchema.index({ name: 1, language: 1, channel: 1 }, { unique: true });

export default TemplateSchema;
