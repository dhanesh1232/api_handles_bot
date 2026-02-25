/**
 * leadNote.model.ts
 * Human-written notes. Editable, pinnable. Separate from activities.
 * Place at: src/model/saas/crm/leadNote.model.ts
 */

import mongoose, { type Schema } from "mongoose";

const leadNoteSchema: Schema<ILeadNote> = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, index: true },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    content: { type: String, required: true },
    isPinned: { type: Boolean, default: false },
    createdBy: { type: String, default: "user" },
  },
  { timestamps: true },
);

leadNoteSchema.index({ clientCode: 1, leadId: 1, isPinned: -1, createdAt: -1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export { leadNoteSchema as LeadNoteSchema };
export default leadNoteSchema;
