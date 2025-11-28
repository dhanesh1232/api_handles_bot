const statuses = [
  "new",
  "researching",
  "qualified",
  "not-qualified",
  "contacted",
  "responded",
  "follow-up",
  "negotiation",
  "proposal-sent",
  "closed-won",
  "closed-lost",
  "no-response",
  "not-interested",
];

import mongoose from "mongoose";

const FollowUpSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    method: {
      type: String,
      enum: ["call", "whatsapp", "email", "sms", "in-person", "other"],
      required: true,
    },
    outcome: {
      type: String,
      enum: [
        "connected",
        "no-answered",
        "interested",
        "busy",
        "not-interested",
        "follow-up-scheduled",
        "wrong-number",
        "converted",
      ],
      default: null,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    date: { type: Date, default: Date.now },

    // advanced
    nextFollowUpDate: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // attachments
    attachments: [
      {
        fileUrl: String,
        fileName: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { _id: true }
);

const ActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "created",
        "status-changed",
        "follow-up",
        "note-added",
        "assigned",
        "proposal-sent",
        "file-uploaded",
        "price-quoted",
      ],
    },
    message: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    meta: {},
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const NoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    visibility: {
      type: String,
      enum: ["internal", "public"],
      default: "internal",
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: null },
  },
  { _id: true }
);

const initialData = {
  title: { type: String, required: true },
  name: { type: String, default: null },
  totalScore: { type: Number, default: null },
  reviewsCount: { type: Number, default: null },

  street: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  countryCode: { type: String, default: null },
  website: { type: String, default: null },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  categoryName: { type: String, default: null },
  url: { type: String, default: null },
};

const LeadSchema = new mongoose.Schema(
  {
    ...initialData,

    status: {
      type: String,
      enum: [...statuses],
      default: "new",
    },

    servicesOffered: [
      {
        name: String,
        description: String,
        price: Number,
      },
    ],

    serviceSelected: { type: String, default: null },

    followUps: [FollowUpSchema],

    followUpCount: { type: Number, default: 0 },
    maxFollowUpsAllowed: { type: Number, default: 6 },

    nextFollowUpDate: { type: Date, default: null },
    lastFollowUpDate: { type: Date, default: null },

    // overdue flags
    followUpOverdue: { type: Boolean, default: false },

    // First contact logic
    firstContactDue: { type: Date, default: null }, // created + 5 days
    firstContactAt: { type: Date, default: null },
    firstContactDone: { type: Boolean, default: false },
    firstContactOverdue: { type: Boolean, default: false },

    research: {
      status: { type: Boolean, default: false },
      notes: { type: String, default: null },
      done: { type: Boolean, default: null },
    },

    lostReason: {
      type: String,
      enum: [
        null,
        "budget-too-low",
        "not-interested",
        "found-competitor",
        "no-response",
        "timing-issue",
        "wrong-fit",
        "other",
      ],
      default: null,
    },

    quotedPrice: { type: Number, default: null },
    finalPrice: { type: Number, default: null },
    currency: { type: String, default: "INR" },

    dealProbability: { type: Number, default: 0 },

    attachments: [
      {
        fileUrl: String,
        fileName: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    reminderDate: { type: Date, default: null },
    callBackDate: { type: Date, default: null },

    notes: [NoteSchema],

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    source: {
      type: String,
      enum: [
        "apify",
        "manual",
        "referral",
        "import",
        "website",
        "google-map",
        "other",
      ],
      default: "apify",
    },

    timeline: { type: String, default: null },
    activity: [ActivitySchema],
    purpose: { type: String, default: null },
    leadScore: { type: Number, default: 0 },

    tags: [{ type: String }],
  },
  { timestamps: true }
);

export const Lead = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);
