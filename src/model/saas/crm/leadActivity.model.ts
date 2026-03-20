/**
 * @module CRM/LeadActivityModel
 * @responsibility Records immutable timeline events for a lead.
 *
 * **WORKING PROCESS:**
 * 1. Categorization: Tracks diverse interactions (whatsapp, email, meetings, stage changes).
 * 2. Immutability: Standardized to disable `updatedAt` as activities represent a fixed point in history.
 * 3. Attribution: Records who performed the action (`performedBy`) for audit trails.
 * 4. Context: The `metadata` field stores event-specific data (e.g., message snippets, duration).
 */

import mongoose, { type Schema } from "mongoose";

const leadActivitySchema: Schema<ILeadActivity> = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, index: true },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "whatsapp_sent",
        "whatsapp_received",
        "whatsapp_delivered",
        "whatsapp_read",
        "email_sent",
        "email_opened",
        "email_clicked",
        "email_bounced",
        "call_logged",
        "meeting_created",
        "meeting_completed",
        "meeting_cancelled",
        "stage_change",
        "deal_won",
        "deal_lost",
        "tag_added",
        "tag_removed",
        "note_added",
        "score_updated",
        "lead_created",
        "lead_assigned",
        "automation_triggered",
        "system",
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    performedBy: { type: String, default: "system" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // activities are immutable
  },
);

leadActivitySchema.index({ clientCode: 1, leadId: 1, createdAt: -1 });
leadActivitySchema.index({ clientCode: 1, type: 1, createdAt: -1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export { leadActivitySchema as LeadActivitySchema };
export default leadActivitySchema;
