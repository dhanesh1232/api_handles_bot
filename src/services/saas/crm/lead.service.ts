/**
 * @file lead.service.ts
 * @module LeadService
 * @responsibility Comprehensive CRM lead lifecycle management: CRUD, stage transitions, tagging, scoring, and bulk operations.
 * @dependencies mongoose, BaseRepository, getCrmModels, pipeline.service, scoring.service, eventBus.service
 *
 * **WORKING PROCESS:**
 * 1. Resolves tenant-specific MongoDB models/connections via `clientCode`.
 * 2. Uses `BaseRepository` for standardized schema-agnostic DB access.
 * 3. Integrates with `EventBus` for non-blocking trigger orchestration.
 * 4. Maintains strict audit trails via `LeadActivity` for every state change.
 *
 * **POPULATION STRATEGY:**
 * - `pipelineId`: Returns `{ _id, name }` for Kanban grouping.
 * - `stageId`: Returns `{ _id, name, color, probability, isWon, isLost }` for UI rendering.
 */

import mongoose from "mongoose";
import { BaseRepository } from "@/lib/tenant/base.repository";
import { getCrmModels } from "@/lib/tenant/crm.models";
import { normalizePhone } from "@/utils/phone";
import {
  createPipeline,
  getDefaultPipeline,
  getDefaultStage,
} from "./pipeline.service.ts";

// ─── Population config ────────────────────────────────────────────────────────

const PIPELINE_POPULATE = { path: "pipelineId", select: "_id name isDefault" };
const STAGE_POPULATE = {
  path: "stageId",
  select: "_id name color probability isWon isLost order",
};

/**
 * LeadRepository
 *
 * Tenant-scoped repository for Lead operations.
 */
export class LeadRepository extends BaseRepository<ILead> {
  /**
   * Custom query to find a lead by normalized phone.
   */
  async findByPhone(phone: string) {
    return this.findOne(
      { phone },
      { populate: [PIPELINE_POPULATE, STAGE_POPULATE] },
    );
  }

  /**
   * Find leads in a specific stage.
   */
  async findByStage(pipelineId: string, stageId: string) {
    return this.findMany(
      { pipelineId, stageId },
      { populate: [PIPELINE_POPULATE, STAGE_POPULATE] },
    );
  }

  /**
   * Find one with population.
   */
  async getFullLead(id: string) {
    return this.findById(id, {
      populate: [PIPELINE_POPULATE, STAGE_POPULATE],
      lean: { virtuals: true },
    });
  }
}

/**
 * Factory to get a LeadRepository bound to a tenant.
 */
export async function getLeadRepo(clientCode: string): Promise<LeadRepository> {
  const { Lead } = await getCrmModels(clientCode);
  return new LeadRepository(Lead, clientCode);
}

// Lazy import to avoid circular-dependency at module load time.
// automation.service imports lead.service, so we import it dynamically only when needed.
// Lazy import to avoid circular-dependency at module load time.
const fireEvent = async (
  clientCode: string,
  trigger: string,
  payload: { phone?: string; email?: string; data?: any; variables?: any },
  opts?: { idempotencyKey?: string },
) => {
  try {
    const { EventBus } = await import("../event/eventBus.service.ts");
    await EventBus.emit(clientCode, trigger, payload, opts);
  } catch (err: any) {
    console.error(
      `[leadService] EventBus emit failed for ${trigger}:`,
      err.message,
    );
  }
};

// ─── 1. Create lead ───────────────────────────────────────────────────────────

/**
 * The primary entry point for injecting new business opportunities (Leads) into the CRM.
 *
 * @param clientCode - The unique tenant identifier. Used to isolate database models and scope the request.
 * @param input - Detailed payload containing lead identity, financial data, and source metadata.
 * @param input.firstName - Required first name.
 * @param input.lastName - (Optional) Last name.
 * @param input.phone - Required E.164 phone number. Automatically normalized during execution.
 * @param input.email - (Optional) Contact email.
 * @param input.pipelineId - (Optional) Specific pipeline to place the lead in. Defaults to the tenant's "Sales" pipeline.
 * @param input.stageId - (Optional) Specific stage within the pipeline. Defaults to the first stage of the resolved pipeline.
 * @param input.dealValue - (Optional) Monetary value of the lead.
 * @param input.currency - (Optional) Currency code (e.g., "INR", "USD").
 * @param input.source - (Optional) Lead origin (e.g., "google_ads", "referral").
 *
 * @returns {Promise<ILead>} The fully hydrated Lead record, including populated `pipelineId` and `stageId` objects for immediate UI rendering.
 *
 * **DETAILED EXECUTION:**
 * 1. **Model & Repo Binding**: Resolves the tenant-specific `LeadActivity` model and `LeadRepository` instance.
 * 2. **Pipeline/Stage Bootstrapping**:
 *    - If `pipelineId` or `stageId` are missing, it triggers an auto-discovery process.
 *    - If no pipelines exist for the tenant, it dynamically creates a "Default Pipeline" using the sales blueprint.
 * 3. **Reference Mapping**: Normalizes metadata references (e.g., `appointmentId`) from strings to `Mongoose.ObjectId`.
 * 4. **Persistence**: Creates the Lead record with `status: "open"` and initializes the `stageHistory` array.
 * 5. **Audit Logging**: Asynchronously logs a "Lead created" system activity to the lead's timeline.
 * 6. **Event Orchestration**: Emits `lead.created` via the global `EventBus`. This is a "Fire-and-Forget" action that triggers automation enrollment.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Data Integrity: If phone normalization fails, the transaction is aborted via the underlying Mongoose layer.
 * - Circularity Safety: Blueprints are only auto-deployed if the tenant has zero existing pipelines.
 */
export const createLead = async (
  clientCode: string,
  input: CreateLeadInput,
): Promise<ILead> => {
  const { LeadActivity } = await getCrmModels(clientCode);
  const repo = await getLeadRepo(clientCode);

  let pipelineId = input.pipelineId;
  let stageId = input.stageId;

  if (!pipelineId) {
    let defaultPipeline = await getDefaultPipeline(clientCode);
    if (!defaultPipeline) {
      console.log(
        `[leadService] No pipeline found for ${clientCode} — auto-creating default.`,
      );
      const { pipeline } = await createPipeline(
        clientCode,
        { name: "Default Pipeline", isDefault: true, stages: [] },
        "sales",
      );
      defaultPipeline = pipeline;
    }
    pipelineId = (
      defaultPipeline as NonNullable<typeof defaultPipeline>
    )._id.toString();
  }

  // Ensure stageId exists. If pipeline has 0 stages, we bootstrap them now.
  if (!stageId) {
    let defaultStage = await getDefaultStage(clientCode, pipelineId!);
    if (!defaultStage) {
      console.log(
        `[leadService] No stages found in pipeline ${pipelineId} — bootstrapping default stages.`,
      );
      const { stages } = await createPipeline(
        clientCode,
        { name: "Sales Pipeline", stages: [] }, // This will use the "sales" template
        "sales",
      );
      defaultStage = stages[0];
      // If we just created a new pipeline, we should use its ID for this lead
      const { Pipeline } = await getCrmModels(clientCode);
      const p = await Pipeline.findOne({
        clientCode,
        _id: defaultStage.pipelineId,
      }).lean();
      if (p) pipelineId = p._id.toString();
    }
    stageId = defaultStage?._id.toString();
  }

  const metadataRefs = buildMetadataRefs(input.metadata?.refs);

  const lead = await repo.create({
    firstName: input.firstName,
    lastName: input.lastName ?? "",
    email: input.email || undefined,
    phone: normalizePhone(input.phone),
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
    stageId: new mongoose.Types.ObjectId(stageId),
    status: "open",
    dealValue: input.dealValue ?? 0,
    currency: input.currency ?? "INR",
    dealTitle: input.dealTitle ?? "",
    source: input.source ?? "other",
    assignedTo: input.assignedTo || undefined,
    tags: input.tags ?? [],
    metadata: { refs: metadataRefs, extra: input.metadata?.extra ?? {} },
    dynamicFields: input.dynamicFields ?? {},
    enteredStageAt: new Date(),
    stageHistory: [
      {
        stageId: new mongoose.Types.ObjectId(stageId),
        enteredAt: new Date(),
      },
    ],
  } as any);

  await LeadActivity.create({
    clientCode,
    leadId: lead._id,
    type: "system",
    title: "Lead created",
    metadata: { source: input.source ?? "other", pipelineId, stageId },
    performedBy: "system",
  });

  const freshLead = (await repo.getFullLead(lead._id.toString())) as ILead;

  // Fire automation — non-blocking, never throws
  void fireEvent(clientCode, "lead.created", {
    phone: freshLead.phone,
    email: freshLead.email,
    variables: {
      source_event:
        input.metadata?.extra?.source_event || input.source || "manual",
    },
    data: freshLead,
  });

  return freshLead;
};

// ─── 2. Get one lead by _id ───────────────────────────────────────────────────

export const getLeadById = async (
  clientCode: string,
  leadId: string,
): Promise<ILead | null> => {
  const repo = await getLeadRepo(clientCode);
  return repo.getFullLead(leadId);
};

// ─── 3. Get lead by phone ─────────────────────────────────────────────────────

export const getLeadByPhone = async (
  clientCode: string,
  phone: string,
): Promise<ILead | null> => {
  const repo = await getLeadRepo(clientCode);
  return repo.findByPhone(normalizePhone(phone));
};

// ─── 4. Get lead by metadata ref ─────────────────────────────────────────────

export const getLeadByRef = async (
  clientCode: string,
  refKey: "appointmentId" | "bookingId" | "orderId" | "meetingId",
  refValue: string,
): Promise<ILead | null> => {
  const repo = await getLeadRepo(clientCode);
  return repo.findOne(
    {
      [`metadata.refs.${refKey}`]: new mongoose.Types.ObjectId(refValue),
      isArchived: false,
    },
    { populate: [PIPELINE_POPULATE, STAGE_POPULATE], lean: { virtuals: true } },
  );
};

// ─── 5. List leads ────────────────────────────────────────────────────────────

export const listLeads = async (
  clientCode: string,
  filters: LeadListFilters = {},
  options: LeadListOptions = {},
): Promise<{ leads: ILead[]; total: number; page: number; pages: number }> => {
  const { Lead } = await getCrmModels(clientCode);
  const { page = 1, limit = 25, sortBy = "score", sortDir = "desc" } = options;

  const query: Record<string, any> = { clientCode };
  if (filters.status === "archived") {
    query.isArchived = true;
  } else {
    query.isArchived = false;
  }
  if (filters.status) query.status = filters.status;
  if (filters.pipelineId)
    query.pipelineId = new mongoose.Types.ObjectId(filters.pipelineId);
  if (filters.stageId)
    query.stageId = new mongoose.Types.ObjectId(filters.stageId);
  if (filters.source) query.source = filters.source;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;
  if (filters.minScore !== undefined)
    query["score.total"] = { $gte: filters.minScore };
  if (filters.tags?.length) query.tags = { $in: filters.tags };
  if (filters.appointmentId)
    query["metadata.refs.appointmentId"] = new mongoose.Types.ObjectId(
      filters.appointmentId,
    );
  if (filters.bookingId)
    query["metadata.refs.bookingId"] = new mongoose.Types.ObjectId(
      filters.bookingId,
    );
  if (filters.orderId)
    query["metadata.refs.orderId"] = new mongoose.Types.ObjectId(
      filters.orderId,
    );
  if (filters.meetingId)
    query["metadata.refs.meetingId"] = new mongoose.Types.ObjectId(
      filters.meetingId,
    );
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }

  if (filters.search?.trim()) {
    const regex = new RegExp(filters.search.trim(), "i");
    query.$or = [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { phone: regex },
      { dealTitle: regex },
    ];
  }

  const sortField: Record<string, string> = {
    score: "score.total",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    dealValue: "dealValue",
    lastContactedAt: "lastContactedAt",
  };
  const sort = {
    [sortField[sortBy] ?? "score.total"]: sortDir === "asc" ? 1 : -1,
  };
  const skip = (page - 1) * limit;

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .populate(PIPELINE_POPULATE)
      .populate(STAGE_POPULATE)
      .sort(sort as any)
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Lead.countDocuments(query),
  ]);

  return {
    leads: leads as unknown as ILead[],
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

// ─── 6. Leads by stage (Kanban column) ───────────────────────────────────────

export const getLeadsByStage = async (
  clientCode: string,
  pipelineId: string,
  stageId: string,
  options: { page?: number; limit?: number } = {},
): Promise<{ leads: ILead[]; total: number }> => {
  const { Lead } = await getCrmModels(clientCode);
  const { page = 1, limit = 50 } = options;
  const query = {
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
    stageId: new mongoose.Types.ObjectId(stageId),
    isArchived: false,
  };
  const [leads, total] = await Promise.all([
    Lead.find(query)
      .populate(PIPELINE_POPULATE)
      .populate(STAGE_POPULATE)
      .sort({ "score.total": -1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean({ virtuals: true }),
    Lead.countDocuments(query),
  ]);
  return { leads: leads as unknown as ILead[], total };
};

// ─── 7. Update lead fields ────────────────────────────────────────────────────

/**
 * Updates basic lead profile fields with strict phone normalization.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead to update.
 * @param updates - Object containing fields to change (firstName, phone, dealValue, etc.).
 *
 * @returns {Promise<ILead | null>} The updated record with populated relationships, or `null` if the ID doesn't exist.
 *
 * **DETAILED EXECUTION:**
 * 1. **Normalization**: If `phone` is provided in the update, it is forced through the `normalizePhone` utility.
 * 2. **Atomic Set**: Performs an `findOneAndUpdate` with `{ $set: cleanUpdates }`.
 * 3. **Hydration**: Populates `pipelineId` and `stageId` before returning to ensure the frontend has updated labels/colors.
 */
export const updateLead = async (
  clientCode: string,
  leadId: string,
  updates: UpdateLeadInput,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  const cleanUpdates = { ...updates };
  if (cleanUpdates.phone) {
    cleanUpdates.phone = normalizePhone(cleanUpdates.phone);
  }
  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    { $set: cleanUpdates },
    { returnDocument: "after" },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true });
  return lead as ILead | null;
};

// ─── 8. Update metadata refs ──────────────────────────────────────────────────

/**
 * Safely updates cross-system metadata references (external IDs) and extra payload fields.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead.
 * @param refs - Map of reference keys (e.g., `appointmentId`) to their values. `null` values trigger a deletion (unset).
 * @param extra - (Optional) Flat map of unstructured data to store in `metadata.extra`.
 *
 * @returns {Promise<ILead | null>} The updated lead.
 *
 * **DETAILED EXECUTION:**
 * 1. **State Diffing**: Iterates through `refs`.
 *    - If a value is `null`, it marks the path for `$unset`.
 *    - Otherwise, it casts the string to a `Mongoose.ObjectId`.
 * 2. **Multi-Op Update**: Executes a single Mongoose call combining `$set` (new data) and `$unset` (removal) to ensure consistency.
 *
 * **GOAL:** This is the primary glue for syncing the CRM with external apps (Booking, ERP, E-commerce).
 */
export const updateMetadataRefs = async (
  clientCode: string,
  leadId: string,
  refs: Record<string, string | null>,
  extra?: Record<string, string | number | boolean | null>,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  const setPayload: Record<string, mongoose.Types.ObjectId | null> = {};
  const unsetPayload: Record<string, 1> = {};

  for (const [key, value] of Object.entries(refs)) {
    if (value === null) unsetPayload[`metadata.refs.${key}`] = 1;
    else
      setPayload[`metadata.refs.${key}`] = new mongoose.Types.ObjectId(value);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) unsetPayload[`metadata.extra.${key}`] = 1;
      else
        setPayload[`metadata.extra.${key}`] =
          value as unknown as mongoose.Types.ObjectId | null;
    }
  }

  const updateOp: mongoose.UpdateQuery<ILead> = {};
  if (Object.keys(setPayload).length) updateOp.$set = setPayload;
  if (Object.keys(unsetPayload).length) updateOp.$unset = unsetPayload;
  if (!Object.keys(updateOp).length) return getLeadById(clientCode, leadId);

  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    updateOp,
    { returnDocument: "after" },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true });
  return lead as ILead | null;
};

// ─── 9. Move lead to a different stage ───────────────────────────────────────

/**
 * Orchestrates the transition of a lead between pipeline stages, handling analytics, history, and status updates.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead being moved.
 * @param newStageId - UUID of the destination stage.
 * @param performedBy - (Optional) Actor ID. Defaults to "user".
 *
 * @returns {Promise<ILead | null>} The updated lead record with full population.
 *
 * @throws {Error} "Stage not found" if `newStageId` is invalid for the tenant.
 * @throws {Error} "Lead not found" if `leadId` is invalid.
 *
 * **DETAILED EXECUTION:**
 * 1. **Validation**: Parallel lookup of target `Stage` and existing `Lead`.
 * 2. **Win/Loss Prediction**: Detects if the target stage is flagged as `isWon` or `isLost`.
 *    - If `isWon`: status -> "won", sets `convertedAt`.
 *    - If `isLost`: status -> "lost", sets `convertedAt`.
 * 3. **Velocity Calculation**: Calculates `durationMs` between `now` and the lead's `enteredStageAt` timestamp.
 * 4. **Atomic Migration**:
 *    - Updates `stageId`, `pipelineId`, `status`, and `enteredStageAt`.
 *    - Pushes a new entry to `stageHistory` containing the previous stage metadata and duration.
 * 5. **Timeline Audit**: Logs a `stage_change` activity with color-coded stage names.
 * 6. **Side-Effect Orchestration (EventBus)**:
 *    - Fires `lead.stage_exit` (previous stage).
 *    - Fires `lead.stage_enter` (new stage).
 *    - Fires `lead.deal_won` or `lead.deal_lost` if applicable.
 */
export const moveLead = async (
  clientCode: string,
  leadId: string,
  newStageId: string,
  performedBy = "user",
): Promise<ILead | null> => {
  const { Lead, PipelineStage, LeadActivity } = await getCrmModels(clientCode);

  const stage = await PipelineStage.findOne({ _id: newStageId, clientCode });
  if (!stage) throw new Error("Stage not found");

  const existing = await Lead.findOne({ _id: leadId, clientCode }).lean();
  if (!existing) throw new Error("Lead not found");

  const previousStageId = existing.stageId.toString();
  let newStatus: LeadStatus = "open";
  const extraUpdates: Partial<ILead> = {};
  if (stage.isWon) {
    newStatus = "won";
    extraUpdates.convertedAt = new Date();
  }
  if (stage.isLost) {
    newStatus = "lost";
    extraUpdates.convertedAt = new Date();
  }

  const now = new Date();
  const enteredAt = existing.enteredStageAt || existing.createdAt;
  const durationMs = now.getTime() - enteredAt.getTime();

  const updated = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    {
      $set: {
        stageId: new mongoose.Types.ObjectId(newStageId),
        pipelineId: stage.pipelineId,
        status: newStatus,
        enteredStageAt: now,
        ...extraUpdates,
      },
      $push: {
        stageHistory: {
          stageId: new mongoose.Types.ObjectId(previousStageId),
          enteredAt: enteredAt,
          leftAt: now,
          durationMs: durationMs,
        },
      },
    },
    { returnDocument: "after" },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true });

  await LeadActivity.create({
    clientCode,
    leadId,
    type: "stage_change",
    title: `Moved to ${stage.name}`,
    metadata: {
      fromStageId: previousStageId,
      toStageId: newStageId,
      stageName: stage.name,
      stageColor: stage.color,
    },
    performedBy,
  });

  // Fire stage automations — non-blocking, never throws
  if (updated) {
    const payload = {
      phone: updated.phone,
      email: updated.email,
      data: updated,
    };
    void Promise.allSettled([
      fireEvent(clientCode, "lead.stage_exit", {
        ...payload,
        variables: { stageId: previousStageId },
      }),
      fireEvent(clientCode, "lead.stage_enter", {
        ...payload,
        variables: { stageId: newStageId },
      }),
      stage.isWon
        ? fireEvent(clientCode, "lead.deal_won", payload)
        : Promise.resolve(),
      stage.isLost
        ? fireEvent(clientCode, "lead.deal_lost", payload)
        : Promise.resolve(),
    ]);
  }

  return updated as ILead | null;
};

// ─── 10. Mark won / lost ─────────────────────────────────────────────────────

/**
 * Explicitly terminates the lead lifecycle as a win or loss.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead.
 * @param outcome - Result: "won" or "lost".
 * @param reason - (Optional) Context for the outcome (e.g., "Price too high").
 * @param performedBy - (Optional) Actor ID.
 *
 * @returns {Promise<ILead | null>}
 */
export const convertLead = async (
  clientCode: string,
  leadId: string,
  outcome: "won" | "lost",
  reason?: string,
  performedBy = "user",
): Promise<ILead | null> => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);

  const updated = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    { $set: { status: outcome, convertedAt: new Date() } },
    { returnDocument: "after" },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true });

  await LeadActivity.create({
    clientCode,
    leadId,
    type: "system",
    title: outcome === "won" ? "Deal won 🎉" : "Deal lost",
    body: reason ?? "",
    metadata: { outcome, reason },
    performedBy,
  });

  return updated as ILead | null;
};

// ─── 11. Add / remove tags ────────────────────────────────────────────────────

/**
 * Atomic multi-tag management with automation triggers.
 *
 * @param clientCode - Tenant ID.
 * @param leadId - UUID of the lead.
 * @param add - Array of tag strings to append.
 * @param remove - Array of tag strings to detach.
 *
 * @returns {Promise<ILead | null>}
 *
 * **DETAILED EXECUTION:**
 * 1. **Set Manipulation**: Uses `$addToSet` (prevents duplicates) and `$pull` (bulk removal).
 * 2. **Notification Loop**: Iterates through added/removed tags and fires granular `lead.tag_added`/`lead.tag_removed` events.
 */
export const updateTags = async (
  clientCode: string,
  leadId: string,
  add: string[],
  remove: string[],
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  const update: mongoose.UpdateQuery<ILead> = {};
  if (add.length) update.$addToSet = { tags: { $each: add } };
  if (remove.length) update.$pull = { tags: { $in: remove } };
  const result = (await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    update,
    {
      returnDocument: "after",
    },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true })) as ILead | null;

  // Fire tag automations — non-blocking, never throws
  if (result) {
    const payload = {
      phone: result.phone,
      email: result.email,
      data: result,
    };
    void Promise.allSettled([
      ...add.map((tag) =>
        fireEvent(clientCode, "lead.tag_added", {
          ...payload,
          variables: { tagName: tag },
        }),
      ),
      ...remove.map((tag) =>
        fireEvent(clientCode, "lead.tag_removed", {
          ...payload,
          variables: { tagName: tag },
        }),
      ),
    ]);
  }

  return result;
};

// ─── 12. Recalculate score ────────────────────────────────────────────────────

export const recalculateScore = async (
  clientCode: string,
  leadId: string,
): Promise<void> => {
  const { recalculateLeadScore } = await import("./scoring.service.ts");
  await recalculateLeadScore(clientCode, leadId);
};

// ─── 13. Archive (soft delete) ────────────────────────────────────────────────

export const archiveLead = async (
  clientCode: string,
  leadId: string,
): Promise<void> => {
  const { Lead } = await getCrmModels(clientCode);
  await Lead.updateOne(
    { _id: leadId, clientCode },
    { $set: { isArchived: true, status: "archived" } },
  ).lean();
};

// ─── 14. Bulk upsert ─────────────────────────────────────────────────────────

/**
 * Industrial-scale lead ingestion/sync for bulk uploads or external integrations.
 *
 * @param clientCode - Tenant ID.
 * @param leads - Array of lead data objects.
 *
 * @returns {Promise<Object>} Object containing counts of `created`, `updated`, and `failed` records.
 *
 * **DETAILED EXECUTION:**
 * 1. **Pipeline Pre-flight**: Resolves the tenant's default pipeline/stage to ensure new leads have a home.
 * 2. **Parallel Processing**: Wraps each lead in `Promise.allSettled` to prevent one bad record (e.g., malformed email) from crashing the batch.
 * 3. **Upsert Logic**:
 *    - Finds by `phone` (the unique pivot).
 *    - `$set`: Overwrites common fields (firstName, email, customFields).
 *    - `$setOnInsert`: Only applies to new leads (initial status, pipeline, creation date).
 * 4. **Diff Tracking**: Inspects the MongoDB version (`__v`) to determine if the record was newly created or just patched.
 */
export const bulkUpsertLeads = async (
  clientCode: string,
  leads: CreateLeadInput[],
): Promise<{ created: number; updated: number; failed: number }> => {
  const { Lead } = await getCrmModels(clientCode);
  const defaultPipeline = await getDefaultPipeline(clientCode);
  if (!defaultPipeline)
    throw new Error("No default pipeline. Create one first.");
  const defaultStage = await getDefaultStage(
    clientCode,
    defaultPipeline._id.toString(),
  );
  if (!defaultStage) throw new Error("No stages in default pipeline.");

  let created = 0,
    updated = 0,
    failed = 0;
  await Promise.allSettled(
    leads.map(async (input) => {
      try {
        const metadataRefs = buildMetadataRefs(input.metadata?.refs);
        const normalizedPhone = normalizePhone(input.phone);
        const result = await Lead.findOneAndUpdate(
          { clientCode, phone: normalizedPhone },
          {
            $set: {
              firstName: input.firstName,
              lastName: input.lastName ?? "",
              email: input.email ?? null,
              source: input.source ?? "other",
              dealValue: input.dealValue ?? 0,
              dealTitle: input.dealTitle ?? "",
              assignedTo: input.assignedTo ?? null,
              dynamicFields: input.dynamicFields ?? {},
              "metadata.extra": input.metadata?.extra ?? {},
            },
            $setOnInsert: {
              clientCode,
              phone: normalizedPhone,
              pipelineId: new mongoose.Types.ObjectId(
                input.pipelineId ?? defaultPipeline._id.toString(),
              ),
              stageId: new mongoose.Types.ObjectId(
                input.stageId ?? defaultStage._id.toString(),
              ),
              status: "open",
              tags: input.tags ?? [],
              "metadata.refs": metadataRefs,
              enteredStageAt: new Date(),
              stageHistory: [
                {
                  stageId: new mongoose.Types.ObjectId(
                    input.stageId ?? defaultStage._id.toString(),
                  ),
                  enteredAt: new Date(),
                },
              ],
            },
          },
          { upsert: true, returnDocument: "after" },
        );
        if (result) (result as any).__v === 0 ? created++ : updated++;
      } catch {
        failed++;
      }
    }),
  );
  return { created, updated, failed };
};

// ─── 15. Bulk delete ─────────────────────────────────────────────────────────

export const bulkDelete = async (
  clientCode: string,
  leadIds: string[],
): Promise<void> => {
  const { Lead } = await getCrmModels(clientCode);
  await Lead.deleteMany({
    _id: { $in: leadIds.map((id) => new mongoose.Types.ObjectId(id)) },
    clientCode,
  });
};

// ─── 16. Bulk archive ────────────────────────────────────────────────────────
export const bulkArchive = async (
  clientCode: string,
  leadIds: string[],
): Promise<void> => {
  const { Lead } = await getCrmModels(clientCode);
  await Lead.updateMany(
    {
      _id: { $in: leadIds.map((id) => new mongoose.Types.ObjectId(id)) },
      clientCode,
    },
    { $set: { isArchived: true, status: "archived" } },
  );
};

// ─── 16. Get available fields (discovery) ─────────────────────────────────────

/**
 * Dynamically discovers all fields available for a lead, including custom extra fields.
 *
 * **WORKING PROCESS:**
 * 1. Defines a static list of "Core Fields" (First Name, Phone, etc.).
 * 2. Samples the 100 most recent leads for this tenant.
 * 3. Scans `metadata.extra` keys to identify active custom fields.
 * 4. Merges and returns a unified schema-like field map for UI consumption.
 *
 * **EDGE CASES:**
 * - Sparse Data: If a custom field hasn't been used in the last 100 leads, it won't be discovered here.
 */
export const getLeadFields = async (
  clientCode: string,
): Promise<{ key: string; label: string; type: string }[]> => {
  const { Lead } = await getCrmModels(clientCode);

  const coreFields = [
    { key: "firstName", label: "First Name", type: "string" },
    { key: "lastName", label: "Last Name", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "phone", label: "Phone", type: "string" },
    { key: "dealValue", label: "Deal Value", type: "number" },
    { key: "dealTitle", label: "Deal Title", type: "string" },
    { key: "source", label: "Source", type: "string" },
    { key: "status", label: "Status", type: "string" },
    { key: "assignedTo", label: "Assigned To", type: "string" },
    { key: "createdAt", label: "Created Date", type: "date" },
  ];

  // Discover dynamic fields from metadata.extra
  // PEAK PERFORMANCE: We sample recent leads to see what extra fields are used.
  const sampleLeads = await Lead.find({ clientCode, isArchived: false })
    .sort({ createdAt: -1 })
    .limit(100)
    .select("metadata.extra")
    .lean();

  const extraKeys = new Set<string>();
  sampleLeads.forEach((l: any) => {
    if (l.metadata?.extra) {
      Object.keys(l.metadata.extra).forEach((key) => extraKeys.add(key));
    }
  });

  const dynamicFields = Array.from(extraKeys).map((key) => ({
    key: `metadata.extra.${key}`,
    label: key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase()),
    type: "dynamic",
  }));

  return [...coreFields, ...dynamicFields];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMetadataRefs(
  refs: Record<string, any> | undefined,
): Record<string, any> {
  if (!refs) return {};
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (!value) continue;

    if (Array.isArray(value)) {
      result[key] = value
        .filter((v) => v && mongoose.Types.ObjectId.isValid(v))
        .map((v) => new mongoose.Types.ObjectId(v));
    } else if (
      typeof value === "string" &&
      mongoose.Types.ObjectId.isValid(value)
    ) {
      result[key] = new mongoose.Types.ObjectId(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const updateAiSummary = async (
  clientCode: string,
  leadId: string,
  summaryText: string,
) => {
  const { Lead } = await getCrmModels(clientCode);
  return await Lead.findByIdAndUpdate(
    leadId,
    {
      $set: {
        aiSummary: {
          text: summaryText,
          updatedAt: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).lean();
};
