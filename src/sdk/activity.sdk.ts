/**
 * ActivitySDK
 *
 * Class facade over activity.service.ts.
 * Covers lead activities, call logs, notes, and the unified timeline.
 *
 * @example
 *   const activity = new ActivitySDK(clientCode);
 *   await activity.log({ leadId, type: "email_sent", title: "Intro email sent" });
 *   await activity.createNote(leadId, "Follow up next week");
 */

import {
  createNote,
  deleteNote,
  getActivities,
  getNotes,
  getTimeline,
  logActivity,
  logCall,
  togglePin,
  updateNote,
} from "@services/saas/crm/activity.service";

export class ActivitySDK {
  constructor(private readonly clientCode: string) {}

  // ── Activities ────────────────────────────────────────────────────────────

  /**
   * Log an arbitrary activity on a lead's timeline.
   * Also updates `lastContactedAt` for contact-type activities.
   */
  log(input: LogActivityInput): Promise<ILeadActivity> {
    return logActivity(this.clientCode, input);
  }

  /** Paginated list of activities for a lead. */
  list(
    leadId: string,
    opts: { page?: number; limit?: number; type?: ActivityType } = {},
  ): Promise<{ activities: ILeadActivity[]; total: number }> {
    return getActivities(this.clientCode, leadId, opts);
  }

  /** Shortcut: log a manual call with duration + outcome. */
  logCall(
    leadId: string,
    input: {
      durationMinutes: number;
      summary: string;
      outcome?: "connected" | "voicemail" | "no_answer";
      performedBy?: string;
    },
  ): Promise<ILeadActivity> {
    return logCall(this.clientCode, leadId, input);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  /** Create a note and add a note_added activity automatically. */
  createNote(
    leadId: string,
    content: string,
    createdBy = "user",
  ): Promise<ILeadNote> {
    return createNote(this.clientCode, leadId, content, createdBy);
  }

  /** Get all notes for a lead (pinned first). */
  getNotes(leadId: string): Promise<ILeadNote[]> {
    return getNotes(this.clientCode, leadId);
  }

  /** Update the text content of a note. */
  updateNote(noteId: string, content: string): Promise<ILeadNote | null> {
    return updateNote(this.clientCode, noteId, content);
  }

  /** Toggle the pin state of a note. */
  togglePin(noteId: string): Promise<ILeadNote | null> {
    return togglePin(this.clientCode, noteId);
  }

  /** Hard-delete a note. */
  deleteNote(noteId: string): Promise<void> {
    return deleteNote(this.clientCode, noteId);
  }

  // ── Unified timeline ──────────────────────────────────────────────────────

  /**
   * Combined, reverse-chron timeline of activities + notes for a lead.
   * Useful for sidebar timelines in the lead detail view.
   */
  timeline(
    leadId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ items: TimelineItem[]; total: number }> {
    return getTimeline(this.clientCode, leadId, opts);
  }
}
