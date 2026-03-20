/**
 * @file lead.sdk.ts
 * @module LeadSDK
 * @responsibility Facade for the core CRM lead management system (CRUD, Pipeline, Tags).
 * @dependencies lead.service.ts
 */

import {
  archiveLead,
  bulkArchive,
  bulkDelete,
  bulkUpsertLeads,
  convertLead,
  createLead,
  getLeadById,
  getLeadByPhone,
  getLeadByRef,
  getLeadFields,
  getLeadsByStage,
  listLeads,
  moveLead,
  recalculateScore,
  updateLead,
  updateMetadataRefs,
  updateTags,
} from "@services/saas/crm/lead.service";

export class LeadSDK {
  constructor(private readonly clientCode: string) {}

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Registers a new lead in the system.
   *
   * @param {CreateLeadInput} input - Core lead details (name, phone, stage).
   * @returns {Promise<ILead>} The created lead document.
   *
   * **DETAILED EXECUTION:**
   * 1. **Identity Normalization**: Converts the phone number to E.164 and trims names.
   * 2. **Deduplication Guard**: Checks for an existing lead with the same phone to prevent double-entry.
   * 3. **Pipeline Bootstrapping**: If `pipelineId` is missing, the system auto-resolves the default sales pipeline for the tenant.
   * 4. **Persistence**: Saves the lead and immediately caches the document for fast subsequent retrievals.
   * 5. **Event Emission**: Fires `lead_created` which triggers any configured welcome sequences or automation rules.
   */
  create(input: CreateLeadInput): Promise<ILead> {
    return createLead(this.clientCode, input);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Fetches a lead by its unique database identifier.
   *
   * @param {string} leadId - MongoDB ObjectId.
   * @returns {Promise<ILead | null>}
   */
  getById(leadId: string): Promise<ILead | null> {
    return getLeadById(this.clientCode, leadId);
  }

  /**
   * Retrieves a lead using their primary phone number.
   *
   * **WORKING PROCESS:**
   * 1. Normalizes the input phone number.
   * 2. Performs a tenant-isolated lookup on the `Lead` collection.
   *
   * @param {string} phone - Target phone number.
   * @returns {Promise<ILead | null>}
   */
  getByPhone(phone: string): Promise<ILead | null> {
    return getLeadByPhone(this.clientCode, phone);
  }

  /**
   * Finds a lead based on an external reference ID (e.g., from a booking system).
   *
   * **WORKING PROCESS:**
   * 1. Queries the nested `metadata.refs` object in the Lead document.
   * 2. Supports indexed fields like `appointmentId` or `meetingId`.
   *
   * @param {string} key - Reference key name.
   * @param {string} value - Reference ID value.
   * @returns {Promise<ILead | null>}
   */
  getByRef(
    key: "appointmentId" | "bookingId" | "orderId" | "meetingId",
    value: string,
  ): Promise<ILead | null> {
    return getLeadByRef(this.clientCode, key, value);
  }

  /**
   * Multi-dynamic list fetcher for leads.
   *
   * **WORKING PROCESS:**
   * 1. Combines search queries (name/phone), filter tags, and pipeline stages.
   * 2. Applies sorting based on `score`, `lastActive`, or `createdAt`.
   * 3. Performs paginated fetch with total count.
   *
   * @param {LeadListFilters} [filters={}] - Search and filter criteria.
   * @param {LeadListOptions} [options={}] - Pagination and sorting.
   * @returns {Promise<{ leads: ILead[]; total: number; page: number; pages: number }>}
   */
  list(
    filters: LeadListFilters = {},
    options: LeadListOptions = {},
  ): Promise<{ leads: ILead[]; total: number; page: number; pages: number }> {
    return listLeads(this.clientCode, filters, options);
  }

  /**
   * Fetches all leads belonging to a specific Kanban column.
   *
   * @param {string} pipelineId - Parent pipeline ID.
   * @param {string} stageId - Target stage ID.
   * @param {object} [opts] - Pagination controls.
   * @returns {Promise<{ leads: ILead[]; total: number }>}
   */
  byStage(
    pipelineId: string,
    stageId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ leads: ILead[]; total: number }> {
    return getLeadsByStage(this.clientCode, pipelineId, stageId, opts);
  }

  /**
   * Merges core schema fields and dynamic 'extraFields' into a flat list of definitions.
   * Useful for building dynamic forms or column selectors.
   *
   * @returns {Promise<{ key: string; label: string; type: string }[]>}
   */
  fields(): Promise<{ key: string; label: string; type: string }[]> {
    return getLeadFields(this.clientCode);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Updates core lead properties (firstName, lastName, phone, etc.).
   *
   * **WORKING PROCESS:**
   * 1. Validates the existence of the lead.
   * 2. Sanitizes input fields.
   * 3. Persists changes and returns the updated document.
   *
   * @param {string} leadId - Target lead identifier.
   * @param {UpdateLeadInput} updates - Key/value pairs of fields to change.
   * @returns {Promise<ILead | null>}
   */
  update(leadId: string, updates: UpdateLeadInput): Promise<ILead | null> {
    return updateLead(this.clientCode, leadId, updates);
  }

  /**
   * Updates complex metadata references or extra dynamic fields.
   *
   * **WORKING PROCESS:**
   * 1. Merges `refs` into the `metadata.refs` object (shallow merge).
   * 2. Merges `extra` into the `metadata.extra` object.
   * 3. Setting a value to `null` explicitly removes it from the record.
   *
   * @param {string} leadId - Target lead identifier.
   * @param {Record<string, string | null>} refs - Managed reference keys.
   * @param {Record<string, any>} [extra] - Unstructured extra data.
   * @returns {Promise<ILead | null>}
   */
  updateRefs(
    leadId: string,
    refs: Record<string, string | null>,
    extra?: Record<string, string | number | boolean | null>,
  ): Promise<ILead | null> {
    return updateMetadataRefs(this.clientCode, leadId, refs, extra);
  }

  /**
   * Transitions a lead to a new pipeline stage.
   *
   * @param {string} leadId - Target lead identifier.
   * @param {string} newStageId - Destination stage ID.
   * @param {string} [performedBy="user"] - Actor performing the move.
   * @returns {Promise<ILead | null>}
   *
   * **DETAILED EXECUTION:**
   * 1. **Atomic Update**: Pushes the current stage into the `stageHistory` array with exit/duration metadata.
   * 2. **State Transition**: Updates the `stageId` and `enteredStageAt` fields.
   * 3. **Timeline Event**: Logs a `stage_changed` activity to the lead's history.
   * 4. **Automation Engine**: Fires `lead_stage_changed`, enrolling the lead in any newly applicable automation rules or drip sequences.
   */
  move(
    leadId: string,
    newStageId: string,
    performedBy = "user",
  ): Promise<ILead | null> {
    return moveLead(this.clientCode, leadId, newStageId, performedBy);
  }

  /**
   * Finalizes a lead's outcome in the pipeline.
   *
   * **WORKING PROCESS:**
   * 1. Sets the `status` to 'won' or 'lost'.
   * 2. Sets the `convertedAt` timestamp.
   * 3. Triggers outcome-specific automations (e.g., `lead_won`).
   *
   * @param {string} leadId - Target lead identifier.
   * @param {"won" | "lost"} outcome - The final result.
   * @param {string} [reason] - Optional explanation (especially for 'lost').
   * @param {string} [performedBy="user"] - Actor identifier.
   * @returns {Promise<ILead | null>}
   */
  convert(
    leadId: string,
    outcome: "won" | "lost",
    reason?: string,
    performedBy = "user",
  ): Promise<ILead | null> {
    return convertLead(this.clientCode, leadId, outcome, reason, performedBy);
  }

  /**
   * Syncs tags for a lead, adding new ones and removing specified ones.
   *
   * **WORKING PROCESS:**
   * 1. Calculates the new tag set (union of current + add - remove).
   * 2. Updates the `tags` array on the lead.
   * 3. Fires `tag_added` or `tag_removed` automation events for each change.
   *
   * @param {string} leadId - Target lead identifier.
   * @param {string[]} add - Tags to attach.
   * @param {string[]} remove - Tags to detach.
   * @returns {Promise<ILead | null>}
   */
  tags(leadId: string, add: string[], remove: string[]): Promise<ILead | null> {
    return updateTags(this.clientCode, leadId, add, remove);
  }

  /**
   * Triggers an immediate recalculation of the lead's engagement score.
   *
   * **WORKING PROCESS:**
   * 1. Analyzes activities, message frequency, and response times.
   * 2. Computes a numeric score.
   * 3. Updates the `score` field on the Lead document.
   *
   * @param {string} leadId - Target lead identifier.
   * @returns {Promise<void>}
   */
  recalcScore(leadId: string): Promise<void> {
    return recalculateScore(this.clientCode, leadId);
  }

  // ── Soft delete / bulk ────────────────────────────────────────────────────

  /**
   * Soft-archives a lead, removing them from default views but keeping data.
   *
   * @param {string} leadId - Target lead identifier.
   * @returns {Promise<void>}
   */
  archive(leadId: string): Promise<void> {
    return archiveLead(this.clientCode, leadId);
  }

  /**
   * Massive-scale lead ingestion and synchronization.
   *
   * **WORKING PROCESS:**
   * 1. Uses `p-limit` or bulk Mongo operations for performance.
   * 2. Matches existing leads by normalized `phone`.
   * 3. Updates existing or creates new ones.
   * 4. Returns summary of execution (success/fail counts).
   *
   * @param {CreateLeadInput[]} leads - Array of lead data.
   * @returns {Promise<{ created: number; updated: number; failed: number }>}
   */
  bulkUpsert(
    leads: CreateLeadInput[],
  ): Promise<{ created: number; updated: number; failed: number }> {
    return bulkUpsertLeads(this.clientCode, leads);
  }

  /**
   * Permanently purges leads and associated data from the system.
   *
   * @param {string[]} leadIds - List of object identifiers.
   * @returns {Promise<void>}
   */
  bulkDelete(leadIds: string[]): Promise<void> {
    return bulkDelete(this.clientCode, leadIds);
  }

  /**
   * Bulk archives multiple leads at once.
   *
   * @param {string[]} leadIds - List of object identifiers.
   * @returns {Promise<void>}
   */
  bulkArchive(leadIds: string[]): Promise<void> {
    return bulkArchive(this.clientCode, leadIds);
  }
}
