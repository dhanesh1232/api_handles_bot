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
   *
   * @param {LogActivityInput} input - The activity details.
   * @returns {Promise<ILeadActivity>} The created activity.
   *
   * **DETAILED EXECUTION:**
   * 1. **Context Resolution**: Injects the `clientCode` into the service call to ensure tenant isolation.
   * 2. **Interaction Tracking**: If the activity type is a communication event (call, email, whatsapp), the system automatically bumps the Lead's `lastContactedAt` timestamp.
   * 3. **Persistence**: Saves the activity to the `LeadActivity` collection for the unified timeline.
   * 4. **Intelligence Trigger**: Fires an asynchronous task to recalculate the lead's engagement score based on this new interaction.
   * 5. **Real-time Sync**: Dispatches a socket event to immediately reflect the activity in the agent's dashboard.
   */
  log(input: LogActivityInput): Promise<ILeadActivity> {
    return logActivity(this.clientCode, input);
  }

  /**
   * Paginated list of activities for a lead.
   *
   * **WORKING PROCESS:**
   * 1. Queries the `LeadActivity` collection.
   * 2. Sorts by `createdAt` in descending order (newest first).
   * 3. Applies pagination (`skip`, `limit`).
   * 4. Populates related entities (User, Lead, Conversation) to enrich the data.
   *
   * @param {string} leadId - The ID of the lead.
   * @param {object} opts - Pagination and filtering options.
   * @returns {Promise<{ activities: ILeadActivity[]; total: number }>} Paginated activities.
   */
  list(
    leadId: string,
    opts: { page?: number; limit?: number; type?: ActivityType } = {},
  ): Promise<{ activities: ILeadActivity[]; total: number }> {
    return getActivities(this.clientCode, leadId, opts);
  }

  /**
   * Shortcut: log a manual call with duration + outcome.
   *
   * @param {string} leadId - The ID of the lead.
   * @param {object} input - Call details.
   * @returns {Promise<ILeadActivity>} The created activity.
   *
   * **DETAILED EXECUTION:**
   * 1. **Data Normalization**: Wraps the call details into a standard `call_log` activity type.
   * 2. **Productivity Tracking**: Records `durationMinutes` helping managers analyze sales rep performance.
   * 3. **Side-Effects**: Updates `lastContactedAt` and emits a socket pulse for real-time portfolio health updates.
   */
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

  /**
   * Fetches all notes associated with a lead.
   *
   * **WORKING PROCESS:**
   * 1. Implementation sorts notes such that `isPinned` notes appear first.
   * 2. Secondary sort by `createdAt` descending.
   *
   * @param {string} leadId - Target lead identifier.
   * @returns {Promise<ILeadNote[]>}
   */
  getNotes(leadId: string): Promise<ILeadNote[]> {
    return getNotes(this.clientCode, leadId);
  }

  /**
   * Updates existing note content.
   *
   * **WORKING PROCESS:**
   * 1. Locates note by ID and verifies tenant ownership.
   * 2. Updates the `content` field and `updatedAt` timestamp.
   *
   * @param {string} noteId - Target note identifier.
   * @param {string} content - New text body.
   * @returns {Promise<ILeadNote | null>}
   */
  updateNote(noteId: string, content: string): Promise<ILeadNote | null> {
    return updateNote(this.clientCode, noteId, content);
  }

  /**
   * Toggles the pin/unpin status for a note.
   *
   * **WORKING PROCESS:**
   * 1. Finds the note by ID and verifies tenant access.
   * 2. Toggles the `isPinned` boolean.
   * 3. Notes are sorted by `isPinned` in the UI to keep critical info at the top.
   *
   * @param {string} noteId - Target note identifier.
   * @returns {Promise<ILeadNote | null>}
   */
  togglePin(noteId: string): Promise<ILeadNote | null> {
    return togglePin(this.clientCode, noteId);
  }

  /**
   * Permanently deletes a note.
   *
   * **WORKING PROCESS:**
   * 1. Performs a hard-delete on the `LeadNote` collection.
   * 2. Does NOT currently remove the associated `note_added` activity from the timeline (audit trail remains).
   *
   * @param {string} noteId - Target note identifier.
   * @returns {Promise<void>}
   */
  deleteNote(noteId: string): Promise<void> {
    return deleteNote(this.clientCode, noteId);
  }

  // ── Unified timeline ──────────────────────────────────────────────────────

  /**
   * Generates a unified, chronological timeline of activities and notes.
   *
   * **WORKING PROCESS:**
   * 1. Aggregates both `LeadActivity` and `LeadNote` streams.
   * 2. Normalizes them into a common `TimelineItem` structure.
   * 3. Sorts by `timestamp` descending.
   * 4. Applies pagination.
   *
   * @param {string} leadId - Lead identifier.
   * @param {object} [opts] - Pagination controls.
   * @returns {Promise<{ items: TimelineItem[]; total: number }>}
   */
  timeline(
    leadId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ items: TimelineItem[]; total: number }> {
    return getTimeline(this.clientCode, leadId, opts);
  }
}
