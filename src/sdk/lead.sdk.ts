/**
 * LeadSDK
 *
 * Class facade over lead.service.ts.
 * Bind to a clientCode once; call methods without repeating it.
 *
 * @example
 *   const lead = new LeadSDK(clientCode);
 *   const newLead = await lead.create({ firstName: "Raj", phone: "919..." });
 *   await lead.move(newLead._id, stageId);
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

  /** Create a new lead. Auto-creates pipeline/stage if none exist. */
  create(input: CreateLeadInput): Promise<ILead> {
    return createLead(this.clientCode, input);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Fetch a single lead by its MongoDB _id. */
  getById(leadId: string): Promise<ILead | null> {
    return getLeadById(this.clientCode, leadId);
  }

  /** Fetch a lead by normalised phone number. */
  getByPhone(phone: string): Promise<ILead | null> {
    return getLeadByPhone(this.clientCode, phone);
  }

  /**
   * Fetch a lead by a metadata ref key/value pair.
   * e.g. lead.getByRef("appointmentId", "64abc...")
   */
  getByRef(
    key: "appointmentId" | "bookingId" | "orderId" | "meetingId",
    value: string,
  ): Promise<ILead | null> {
    return getLeadByRef(this.clientCode, key, value);
  }

  /** Paginated, filterable lead list. */
  list(
    filters: LeadListFilters = {},
    options: LeadListOptions = {},
  ): Promise<{ leads: ILead[]; total: number; page: number; pages: number }> {
    return listLeads(this.clientCode, filters, options);
  }

  /** All leads in one pipeline stage (Kanban column data). */
  byStage(
    pipelineId: string,
    stageId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ leads: ILead[]; total: number }> {
    return getLeadsByStage(this.clientCode, pipelineId, stageId, opts);
  }

  /** Discover all field keys (core + dynamic extra fields). */
  fields(): Promise<{ key: string; label: string; type: string }[]> {
    return getLeadFields(this.clientCode);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /** Update core scalar fields. */
  update(leadId: string, updates: UpdateLeadInput): Promise<ILead | null> {
    return updateLead(this.clientCode, leadId, updates);
  }

  /**
   * Upsert metadata refs / extra fields.
   * Pass `null` as a ref value to unset it.
   */
  updateRefs(
    leadId: string,
    refs: Record<string, string | null>,
    extra?: Record<string, string | number | boolean | null>,
  ): Promise<ILead | null> {
    return updateMetadataRefs(this.clientCode, leadId, refs, extra);
  }

  /** Move lead to a different pipeline stage (fires automations). */
  move(
    leadId: string,
    newStageId: string,
    performedBy = "user",
  ): Promise<ILead | null> {
    return moveLead(this.clientCode, leadId, newStageId, performedBy);
  }

  /** Mark lead won or lost. */
  convert(
    leadId: string,
    outcome: "won" | "lost",
    reason?: string,
    performedBy = "user",
  ): Promise<ILead | null> {
    return convertLead(this.clientCode, leadId, outcome, reason, performedBy);
  }

  /** Add or remove tags (fires tag automations). */
  tags(leadId: string, add: string[], remove: string[]): Promise<ILead | null> {
    return updateTags(this.clientCode, leadId, add, remove);
  }

  /** Trigger a score recalculation for a lead. */
  recalcScore(leadId: string): Promise<void> {
    return recalculateScore(this.clientCode, leadId);
  }

  // ── Soft delete / bulk ────────────────────────────────────────────────────

  /** Soft-archive a single lead. */
  archive(leadId: string): Promise<void> {
    return archiveLead(this.clientCode, leadId);
  }

  /** Bulk upsert leads (phone is the unique key). */
  bulkUpsert(
    leads: CreateLeadInput[],
  ): Promise<{ created: number; updated: number; failed: number }> {
    return bulkUpsertLeads(this.clientCode, leads);
  }

  /** Permanently delete multiple leads by id. */
  bulkDelete(leadIds: string[]): Promise<void> {
    return bulkDelete(this.clientCode, leadIds);
  }

  /** Soft-archive multiple leads. */
  bulkArchive(leadIds: string[]): Promise<void> {
    return bulkArchive(this.clientCode, leadIds);
  }
}
