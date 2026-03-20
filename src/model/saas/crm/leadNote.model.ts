import mongoose, { type Schema } from "mongoose";

/**
 * @module Models/CRM/LeadNote
 * @responsibility Stores collaborative, human-written notes for leads.
 *
 * **GOAL:** Provide a dedicated space for long-form context and team collaboration that remains persistent and high-priority, unlike chronological activities.
 *
 * **DETAILED EXECUTION:**
 * 1. **Schema Definition**: Implements a strict schema with `clientCode` for multi-tenant isolation.
 * 2. **Ref linking**: Uses `mongoose.Schema.Types.ObjectId` to link to the `Lead` model, enabling population.
 * 3. **Pinning Logic**: Includes a boolean `isPinned` which the frontend uses to display notes at the top of the timeline.
 * 4. **Authorship**: Tracks `createdBy` to identify which team member left the note.
 * 5. **Indexing Strategy**:
 *    - Compound index on `{ clientCode: 1, leadId: 1, isPinned: -1, createdAt: -1 }`.
 *    - This ensures that fetching all notes for a specific lead, with pinned ones first and newest second, is an O(1) index-only scan.
 */

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
