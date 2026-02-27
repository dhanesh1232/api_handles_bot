/**
 * activityService.ts
 * Manages the lead timeline (activities) and notes.
 *
 * Auto-called by: whatsappService, meetService, leadService (stage changes).
 * Also called directly from activity/note routes.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogActivityInput {
  leadId: string;
  type: ActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  performedBy?: string;
}

export interface TimelineItem {
  id: string;
  kind: "activity" | "note";
  type?: ActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  isPinned?: boolean;
  performedBy?: string;
  createdBy?: string;
  createdAt: Date;
}

// ─── Activity: log ────────────────────────────────────────────────────────────

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
    );
    // Trigger score recalculation asynchronously (fire-and-forget)
    import("./lead.service.ts")
      .then(({ recalculateScore }) =>
        recalculateScore(clientCode, input.leadId),
      )
      .catch(() => {}); // non-critical
  }

  return activity;
};

// ─── Activity: list for a lead ────────────────────────────────────────────────

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

  await logActivity(clientCode, {
    leadId,
    type: "note_added",
    title: "Note added",
    body: content.slice(0, 120) + (content.length > 120 ? "…" : ""),
    metadata: { noteId: note._id.toString() },
    performedBy: createdBy,
  });

  return note;
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
  const note = await LeadNote.findOne({ _id: noteId, clientCode });
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
