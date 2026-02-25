/**
 * lead.model.ts
 *
 * Central CRM lead document.
 * Place at: src/model/saas/crm/lead.model.ts
 *
 * Key design decisions:
 * - pipelineId + stageId are ObjectId refs → populated on fetch
 * - metadata.refs stores client-side ObjectIds (appointmentId, bookingId, etc.)
 *   These are stored as ObjectId type so the client can use them directly
 *   to query their own collections. They are NOT populated here — the client
 *   resolves them in their own DB.
 * - Every query must include clientCode for tenant isolation.
 */

import mongoose, { type Schema } from "mongoose";

// ─── Schema ───────────────────────────────────────────────────────────────────

const scoreSchema = new mongoose.Schema<ILeadScore>(
  {
    total: { type: Number, default: 0, min: 0, max: 100 },
    recency: { type: Number, default: 0 },
    engagement: { type: Number, default: 0 },
    stageDepth: { type: Number, default: 0 },
    dealSize: { type: Number, default: 0 },
    sourceQuality: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Metadata refs — all ObjectId, all optional
const metadataRefsSchema = new mongoose.Schema(
  {
    appointmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    serviceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    meetingId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    _id: false,
    strict: false, // allows extra ObjectId fields the client adds dynamically
  },
);

const leadSchema: Schema<ILead> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },

    // Identity
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: null },
    phone: { type: String, required: true, trim: true },

    // Pipeline
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true,
    },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PipelineStage",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "won", "lost", "archived"],
      default: "open",
      index: true,
    },

    // Deal
    dealValue: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    dealTitle: { type: String, trim: true, default: "" },

    // Source & assignment
    source: {
      type: String,
      enum: [
        "website",
        "whatsapp",
        "instagram",
        "facebook",
        "referral",
        "cold_outreach",
        "phone",
        "email",
        "walk_in",
        "other",
      ],
      default: "other",
    },
    assignedTo: { type: String, default: null },
    tags: { type: [String], default: [] },

    // Client-side ObjectId references
    metadata: {
      refs: {
        type: metadataRefsSchema,
        default: () => ({}),
      },
      extra: {
        type: mongoose.Schema.Types.Mixed, // plain key-value
        default: () => ({}),
      },
    },

    // Scoring
    score: {
      type: scoreSchema,
      default: () => ({
        total: 0,
        recency: 0,
        engagement: 0,
        stageDepth: 0,
        dealSize: 0,
        sourceQuality: 0,
        updatedAt: new Date(),
      }),
    },

    // Business timestamps
    lastContactedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },

    // Soft delete
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Board query: all open leads for a pipeline, per stage
leadSchema.index({ clientCode: 1, pipelineId: 1, stageId: 1, isArchived: 1 });

// Lead list: filter by status + sort by score
leadSchema.index({ clientCode: 1, status: 1, "score.total": -1 });

// Phone lookup: link WhatsApp conversation → lead
leadSchema.index({ clientCode: 1, phone: 1, pipelineId: 1 }, { unique: true });
leadSchema.index({ clientCode: 1, pipelineId: 1 });

// Email lookup
leadSchema.index({ clientCode: 1, email: 1 }, { sparse: true });

// Metadata ref lookups: find lead by appointmentId, bookingId, etc.
leadSchema.index(
  { clientCode: 1, "metadata.refs.appointmentId": 1 },
  { sparse: true },
);
leadSchema.index(
  { clientCode: 1, "metadata.refs.bookingId": 1 },
  { sparse: true },
);
leadSchema.index(
  { clientCode: 1, "metadata.refs.orderId": 1 },
  { sparse: true },
);
leadSchema.index(
  { clientCode: 1, "metadata.refs.meetingId": 1 },
  { sparse: true },
);

// Score sort
leadSchema.index({ clientCode: 1, "score.total": -1 });

// Tag filter
leadSchema.index({ clientCode: 1, tags: 1 });

// ─── Virtual: full name ───────────────────────────────────────────────────────
leadSchema.virtual("fullName").get(function (this: ILead) {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});

leadSchema.set("toJSON", { virtuals: true });
leadSchema.set("toObject", { virtuals: true });

// ─── Model ────────────────────────────────────────────────────────────────────

export { leadSchema as LeadSchema };
export default leadSchema;
