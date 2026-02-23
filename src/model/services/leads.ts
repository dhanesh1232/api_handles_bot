import mongoose, { type Document, type Model } from "mongoose";

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

export interface IAttachment {
  fileUrl?: string;
  fileName?: string;
  uploadedAt?: Date;
}

export interface IFollowUp {
  message: string;
  method: "call" | "whatsapp" | "email" | "sms" | "in-person" | "other";
  outcome?:
    | "connected"
    | "not-answered"
    | "interested"
    | "busy"
    | "not-interested"
    | "follow-up-scheduled"
    | "wrong-number"
    | "converted"
    | null;
  priority?: "low" | "normal" | "high" | "urgent";
  date?: Date;
  nextFollowUpDate?: Date | null;
  createdBy?: mongoose.Types.ObjectId | null;
  attachments?: IAttachment[];
}

export interface IActivity {
  type?:
    | "created"
    | "status-changed"
    | "follow-up"
    | "note-added"
    | "assigned"
    | "proposal-sent"
    | "file-uploaded"
    | "price-quoted";
  message?: string;
  createdBy?: mongoose.Types.ObjectId | null;
  meta?: any;
  createdAt?: Date;
}

export interface INote {
  text: string;
  createdBy?: mongoose.Types.ObjectId | null;
  visibility?: "internal" | "public";
  createdAt?: Date;
  updatedAt?: Date | null;
}

export interface IServiceLead extends Document {
  title: string;
  name?: string | null;
  leadScore?: number;
  rating?: number;
  reviewsCount?: number;

  street?: string | null;
  city?: string | null;
  state?: string | null;
  countryCode?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  categoryName?: string | null;
  url?: string | null;

  status?: string;

  servicesOffered?: Array<{
    name?: string;
    description?: string;
    price?: number;
  }>;

  serviceSelected?: string | null;

  followUps?: IFollowUp[];

  followUpCount?: number;
  maxFollowUpsAllowed?: number;

  nextFollowUpDate?: Date | null;
  lastFollowUpDate?: Date | null;

  followUpOverdue?: boolean;

  firstContactDue?: Date | null;
  firstContactAt?: Date | null;
  firstContactDone?: boolean;
  firstContactOverdue?: boolean;

  research?: {
    status?: boolean;
    notes?: string | null;
    done?: boolean | null;
  };

  lostReason?:
    | "budget-too-low"
    | "not-interested"
    | "found-competitor"
    | "no-response"
    | "timing-issue"
    | "wrong-fit"
    | "other"
    | null;

  quotedPrice?: number | null;
  finalPrice?: number | null;
  currency?: string;

  dealProbability?: number;

  attachments?: IAttachment[];

  reminderDate?: Date | null;
  callBackDate?: Date | null;

  notes?: INote[];

  assignedTo?: mongoose.Types.ObjectId | null;

  source?:
    | "apify"
    | "manual"
    | "referral"
    | "import"
    | "website"
    | "google-map"
    | "other";

  activity?: IActivity[];
  timeline?: string | null;
  purpose?: string | null;

  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

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
        "not-answered",
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
  { _id: true },
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
  { _id: true },
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
  { _id: true },
);

const initialData = {
  title: { type: String, required: true },
  name: { type: String, default: null },
  leadScore: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  reviewsCount: { type: Number, default: 0 },

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

const LeadSchema = new mongoose.Schema<IServiceLead>(
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

    activity: [ActivitySchema],
    timeline: { type: String, default: null },
    purpose: { type: String, default: null },

    tags: [{ type: String }],
  },
  { timestamps: true },
);

export const Lead: Model<IServiceLead> =
  mongoose.models.Lead || mongoose.model<IServiceLead>("Lead", LeadSchema);
