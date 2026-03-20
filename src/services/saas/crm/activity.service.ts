/**
 * activityService.ts
 * Manages the lead timeline (activities) and notes.
 *
 * Auto-called by: whatsappService, meetService, leadService (stage changes).
 * Also called directly from activity/note routes.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import { getCrmModels } from "@lib/tenant/crm.models";

// ─── Types ────────────────────────────────────────────────────────────────────

// LogActivityInput and TimelineItem are now defined globally in src/types/global.d.ts

// ─── Activity: log ────────────────────────────────────────────────────────────

/**
 * The unified logger for all lead interactions, ensuring a consistent audit trail across the CRM.
 *
 * @param clientCode - Tenant identifier used for dataset isolation.
 * @param input - The interaction payload.
 * @param input.leadId - UUID of the target lead.
 * @param input.type - Category of interaction (e.g., `whatsapp_sent`, `call_logged`, `note_added`).
 * @param input.title - Short, high-level summary of the event (e.g., "Incoming Message").
 * @param input.body - (Optional) Detailed content or verbatim transcript.
 * @param input.metadata - (Optional) Structured data (e.g., `messageSid`, `duration`).
 * @param input.performedBy - (Optional) Actor ID or system tag.
 *
 * @returns {Promise<ILeadActivity>} The persisted activity record.
 *
 * **DETAILED EXECUTION:**
 * 1. **Model Binding**: Dynamically retrieves `Lead` and `LeadActivity` models per tenant.
 * 2. **Immutability**: Persists the event with a server-side `createdAt` timestamp.
 * 3. **Proactive Contact Tracking**:
 *    - If the type is a "Contact Event" (WhatsApp, Email, Call, Meet), it atomically updates the Lead's `lastContactedAt`.
 *    - This update is critical for "Inactive Lead" detection and AI re-engagement triggers.
 * 4. **Asynchronous Scoring**:
 *    - Triggers a "Fire-and-Forget" lead score recalculation.
 *    - Interactions (like a received WhatsApp) immediately boost the lead's "Hotness" score without blocking the API response.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Non-Critical Scoring: Failures in the scoring service are caught locally to ensure the activity is still logged.
 */
export const logActivity = async (
  clientCode: string,
  input: LogActivityInput,
): Promise<ILeadActivity> => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);

  const activity = await LeadActivity.create({
    clientCode,
    leadId: input.leadId,
    type: input.type,
    title: input.title,
    body: input.body ?? "",
    metadata: input.metadata ?? {},
    performedBy: input.performedBy ?? "system",
  });

  const resActivity = activity.toObject() as unknown as ILeadActivity;

  // Update lastContactedAt on the lead for score recalculation
  const contactTypes: ActivityType[] = [
    "whatsapp_sent",
    "whatsapp_received",
    "email_sent",
    "call_logged",
    "meeting_created",
  ];
  if (contactTypes.includes(input.type)) {
    await Lead.updateOne(
      { _id: input.leadId, clientCode },
      { $set: { lastContactedAt: new Date() } },
    ).lean();
    // Trigger score recalculation asynchronously (fire-and-forget)
    import("./lead.service.ts")
      .then(({ recalculateScore }) =>
        recalculateScore(clientCode, input.leadId),
      )
      .catch(() => {}); // non-critical
  }

  return resActivity;
};

// ─── Activity: list for a lead ────────────────────────────────────────────────

/**
 * Retrieves a paginated list of activities for a specific lead, optionally filtered by type.
 *
 * **WORKING PROCESS:**
 * 1. Query Construction: Builds a MongoDB query matching the `clientCode` and `leadId`.
 * 2. Type Filtering: Adds a type constraint to the query if a specific `ActivityType` is requested.
 * 3. Parallel Execution: Concurrently fetches the total count and the sliced activity list for optimal performance.
 * 4. Sorting: Orders activities by `createdAt` in descending order (newest first).
 *
 * **EDGE CASES:**
 * - No Activities: Returns an empty array and total: 0 if the lead has no history.
 * - Large History: Implements pagination (default 50 per page) to prevent memory issues with long timelines.
 *
 * @param clientCode - Tenant identifier.
 * @param leadId - The target lead's unique ID.
 * @param options - Pagination and filtering options (page, limit, type).
 */
export const getActivities = async (
  clientCode: string,
  leadId: string,
  options: { page?: number; limit?: number; type?: ActivityType } = {},
): Promise<{ activities: ILeadActivity[]; total: number }> => {
  const { LeadActivity } = await getCrmModels(clientCode);
  const { page = 1, limit = 50, type } = options;

  const query: Record<string, unknown> = { clientCode, leadId };
  if (type) query.type = type;

  const [activities, total] = await Promise.all([
    LeadActivity.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LeadActivity.countDocuments(query),
  ]);

  return { activities: activities as unknown as ILeadActivity[], total };
};

// ─── Activity: log a manual call ──────────────────────────────────────────────

/**
 * Specialized high-level wrapper for recording telephonic interactions.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead.
 * @param input - Call analytics.
 * @param input.durationMinutes - Total length of the conversation.
 * @param input.summary - Verbatim or summarized notes from the agent.
 * @param input.outcome - Status of the call (`connected`, `voicemail`, `no_answer`).
 * @param input.performedBy - The ID of the salesperson.
 *
 * @returns {Promise<ILeadActivity>}
 */
export const logCall = async (
  clientCode: string,
  leadId: string,
  input: {
    durationMinutes: number;
    summary: string;
    outcome?: "connected" | "voicemail" | "no_answer";
    performedBy?: string;
  },
): Promise<ILeadActivity> => {
  return logActivity(clientCode, {
    leadId,
    type: "call_logged",
    title: `Call logged — ${input.durationMinutes} min`,
    body: input.summary,
    metadata: {
      durationMinutes: input.durationMinutes,
      outcome: input.outcome ?? "connected",
    },
    performedBy: input.performedBy ?? "user",
  });
};

// ─── Note: create ─────────────────────────────────────────────────────────────

/**
 * Creates a collaborative note and pushes a summarized preview to the lead's main timeline.
 *
 * @param clientCode - Tenant identifier.
 * @param leadId - UUID of the lead.
 * @param content - Full markdown or text content of the note.
 * @param createdBy - Actor ID.
 *
 * @returns {Promise<ILeadNote>} The persisted note.
 *
 * **DETAILED EXECUTION:**
 * 1. **Note Persistence**: Saves the raw content to the `LeadNote` collection.
 * 2. **Timeline Notification**:
 *    - To maintain a clean timeline, it creates a "preview" snippet (120 chars).
 *    - This snippet is logged as a `note_added` activity, linking back to the full note ID.
 */
export const createNote = async (
  clientCode: string,
  leadId: string,
  content: string,
  createdBy = "user",
): Promise<ILeadNote> => {
  const { LeadNote } = await getCrmModels(clientCode);

  const note = await LeadNote.create({
    clientCode,
    leadId,
    content,
    isPinned: false,
    createdBy,
  });

  const resNote = note.toObject() as unknown as ILeadNote;

  await logActivity(clientCode, {
    leadId,
    type: "note_added",
    title: "Note added",
    body: content.slice(0, 120) + (content.length > 120 ? "…" : ""),
    metadata: { noteId: resNote._id.toString() },
    performedBy: createdBy,
  });

  return resNote;
};

// ─── Note: get all for a lead ─────────────────────────────────────────────────

export const getNotes = async (
  clientCode: string,
  leadId: string,
): Promise<ILeadNote[]> => {
  const { LeadNote } = await getCrmModels(clientCode);
  return (await LeadNote.find({ clientCode, leadId })
    .sort({ isPinned: -1, createdAt: -1 })
    .lean()) as unknown as ILeadNote[];
};

// ─── Note: update content ─────────────────────────────────────────────────────

export const updateNote = async (
  clientCode: string,
  noteId: string,
  content: string,
): Promise<ILeadNote | null> => {
  const { LeadNote } = await getCrmModels(clientCode);
  return LeadNote.findOneAndUpdate(
    { _id: noteId, clientCode },
    { $set: { content } },
    { returnDocument: "after" },
  ).lean() as Promise<ILeadNote | null>;
};

// ─── Note: toggle pin ─────────────────────────────────────────────────────────

export const togglePin = async (
  clientCode: string,
  noteId: string,
): Promise<ILeadNote | null> => {
  const { LeadNote } = await getCrmModels(clientCode);
  const note = await LeadNote.findOne({ _id: noteId, clientCode }).lean();
  if (!note) return null;
  return LeadNote.findByIdAndUpdate(
    noteId,
    { $set: { isPinned: !note.isPinned } },
    { returnDocument: "after" },
  ).lean() as Promise<ILeadNote | null>;
};

// ─── Note: delete ─────────────────────────────────────────────────────────────

export const deleteNote = async (
  clientCode: string,
  noteId: string,
): Promise<void> => {
  const { LeadNote } = await getCrmModels(clientCode);
  await LeadNote.deleteOne({ _id: noteId, clientCode });
};

// ─── Unified timeline ─────────────────────────────────────────────────────────

/**
 * The "Single Source of Truth" for a Lead's history. Merges disparate data streams into a unified chronological feed.
 *
 * @param clientCode - Tenant identifier.
 * @param leadId - UUID of the lead.
 * @param options - Pagination parameters.
 *
 * @returns {Promise<TimelineItem[]>} A flat, sorted array of mixed types (Activities and Notes).
 *
 * **DETAILED EXECUTION:**
 * 1. **Parallel Stream Retrieval**: Concurrently queries `LeadActivity` (system/automation events) and `LeadNote` (agent comments).
 * 2. **Kind Injection**: Normalizes both collections into a common schema, tagging them as `kind: "activity"` or `kind: "note"`.
 * 3. **Chrono-Sort**: Performs a global descending sort (newest first) in memory.
 * 4. **Windowing**: Applies the pagination slice after the merge to ensure accurate chronological ordering across pages.
 */
export const getTimeline = async (
  clientCode: string,
  leadId: string,
  options: { page?: number; limit?: number } = {},
): Promise<{ items: TimelineItem[]; total: number }> => {
  const { LeadActivity, LeadNote } = await getCrmModels(clientCode);
  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;

  const [activities, notes] = await Promise.all([
    LeadActivity.find({ clientCode, leadId }).sort({ createdAt: -1 }).lean(),
    LeadNote.find({ clientCode, leadId }).sort({ createdAt: -1 }).lean(),
  ]);

  const activityItems: TimelineItem[] = (
    activities as unknown as ILeadActivity[]
  ).map((a) => ({
    id: a._id.toString(),
    kind: "activity",
    type: a.type,
    title: a.title,
    body: a.body,
    metadata: a.metadata,
    performedBy: a.performedBy,
    createdAt: a.createdAt,
  }));

  const noteItems: TimelineItem[] = (notes as unknown as ILeadNote[]).map(
    (n) => ({
      id: n._id.toString(),
      kind: "note",
      title: "Note",
      body: n.content,
      isPinned: n.isPinned,
      createdBy: n.createdBy,
      createdAt: n.createdAt,
    }),
  );

  const all = [...activityItems, ...noteItems].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return { items: all.slice(skip, skip + limit), total: all.length };
};
