/**
 * leadService.ts
 *
 * All lead operations: create, fetch (with populate), move stage,
 * update metadata refs, score calculation, search, bulk ops.
 *
 * Population strategy:
 * - pipelineId → populated: returns { _id, name }
 * - stageId    → populated: returns { _id, name, color, probability, isWon, isLost }
 * - metadata.refs.* → returned as ObjectId strings (client queries their own DB)
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import mongoose from "mongoose";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { normalizePhone } from "../../../utils/phone.ts";
import {
  createPipeline,
  getDefaultPipeline,
  getDefaultStage,
} from "./pipeline.service.ts";

// Lazy import to avoid circular-dependency at module load time.
// automation.service imports lead.service, so we import it dynamically only when needed.
const fireAutomations = async (
  clientCode: string,
  ctx: Parameters<
    (typeof import("./automation.service.ts"))["runAutomations"]
  >[1],
) => {
  try {
    const { runAutomations } = await import("./automation.service.ts");
    await runAutomations(clientCode, ctx);
  } catch {
    // Automation failures must NEVER break the primary DB operation.
  }
};

// ─── Population config ────────────────────────────────────────────────────────

const PIPELINE_POPULATE = { path: "pipelineId", select: "_id name isDefault" };
const STAGE_POPULATE = {
  path: "stageId",
  select: "_id name color probability isWon isLost order",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateLeadInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
  source?: LeadSource;
  dealValue?: number;
  currency?: string;
  dealTitle?: string;
  assignedTo?: string;
  tags?: string[];
  pipelineId?: string;
  stageId?: string;
  metadata?: {
    refs?: {
      appointmentId?: string;
      bookingId?: string;
      orderId?: string;
      productId?: string;
      serviceId?: string;
      meetingId?: string;
      [key: string]: string | undefined;
    };
    extra?: Record<string, string | number | boolean | null>;
  };
}

export interface UpdateLeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  dealValue?: number;
  currency?: string;
  dealTitle?: string;
  assignedTo?: string;
  tags?: string[];
}

// ─── 1. Create lead ───────────────────────────────────────────────────────────

export const createLead = async (
  clientCode: string,
  input: CreateLeadInput,
): Promise<ILead> => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);

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
      });
      if (p) pipelineId = p._id.toString();
    }
    stageId = defaultStage!._id.toString();
  }

  const metadataRefs = buildMetadataRefs(input.metadata?.refs);

  const lead = await Lead.create({
    clientCode,
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
  });

  await LeadActivity.create({
    clientCode,
    leadId: lead._id,
    type: "system",
    title: "Lead created",
    metadata: { source: input.source ?? "other", pipelineId, stageId },
    performedBy: "system",
  });

  const freshLead = (await getLeadById(
    clientCode,
    lead._id.toString(),
  )) as ILead;

  // Fire automation — non-blocking, never throws
  void fireAutomations(clientCode, {
    trigger: "lead_created",
    lead: freshLead,
  });

  return freshLead;
};

// ─── 2. Get one lead by _id ───────────────────────────────────────────────────

export const getLeadById = async (
  clientCode: string,
  leadId: string,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  return Lead.findOne({ _id: leadId, clientCode, isArchived: false })
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true }) as unknown as ILead;
};

// ─── 3. Get lead by phone ─────────────────────────────────────────────────────

export const getLeadByPhone = async (
  clientCode: string,
  phone: string,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  const normalizedPhone = normalizePhone(phone);
  return Lead.findOne({ clientCode, phone: normalizedPhone, isArchived: false })
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true }) as unknown as ILead;
};

// ─── 4. Get lead by metadata ref ─────────────────────────────────────────────

export const getLeadByRef = async (
  clientCode: string,
  refKey: "appointmentId" | "bookingId" | "orderId" | "meetingId",
  refValue: string,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  return Lead.findOne({
    clientCode,
    [`metadata.refs.${refKey}`]: new mongoose.Types.ObjectId(refValue),
    isArchived: false,
  })
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true }) as unknown as ILead;
};

// ─── 5. List leads ────────────────────────────────────────────────────────────

export const listLeads = async (
  clientCode: string,
  filters: LeadListFilters = {},
  options: LeadListOptions = {},
): Promise<{ leads: ILead[]; total: number; page: number; pages: number }> => {
  const { Lead } = await getCrmModels(clientCode);
  const { page = 1, limit = 25, sortBy = "score", sortDir = "desc" } = options;

  const query: Record<string, any> = { clientCode, isArchived: false };
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

export const updateLead = async (
  clientCode: string,
  leadId: string,
  updates: UpdateLeadInput,
): Promise<ILead | null> => {
  const { Lead } = await getCrmModels(clientCode);
  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    { $set: updates },
    { returnDocument: "after" },
  )
    .populate(PIPELINE_POPULATE)
    .populate(STAGE_POPULATE)
    .lean({ virtuals: true });
  return lead as ILead | null;
};

// ─── 8. Update metadata refs ──────────────────────────────────────────────────

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

export const moveLead = async (
  clientCode: string,
  leadId: string,
  newStageId: string,
  performedBy = "user",
): Promise<ILead | null> => {
  const { Lead, PipelineStage, LeadActivity } = await getCrmModels(clientCode);

  const stage = await PipelineStage.findOne({ _id: newStageId, clientCode });
  if (!stage) throw new Error("Stage not found");

  const existing = await Lead.findOne({ _id: leadId, clientCode });
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

  const updated = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    {
      $set: {
        stageId: new mongoose.Types.ObjectId(newStageId),
        pipelineId: stage.pipelineId,
        status: newStatus,
        ...extraUpdates,
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
    void Promise.allSettled([
      fireAutomations(clientCode, {
        trigger: "stage_exit",
        lead: updated as unknown as ILead,
        stageId: previousStageId,
      }),
      fireAutomations(clientCode, {
        trigger: "stage_enter",
        lead: updated as unknown as ILead,
        stageId: newStageId,
      }),
      stage.isWon
        ? fireAutomations(clientCode, {
            trigger: "deal_won",
            lead: updated as unknown as ILead,
          })
        : Promise.resolve(),
      stage.isLost
        ? fireAutomations(clientCode, {
            trigger: "deal_lost",
            lead: updated as unknown as ILead,
          })
        : Promise.resolve(),
    ]);
  }

  return updated as ILead | null;
};

// ─── 10. Mark won / lost ─────────────────────────────────────────────────────

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
    void Promise.allSettled([
      ...add.map((tag) =>
        fireAutomations(clientCode, {
          trigger: "tag_added",
          lead: result,
          tagName: tag,
        }),
      ),
      ...remove.map((tag) =>
        fireAutomations(clientCode, {
          trigger: "tag_removed",
          lead: result,
          tagName: tag,
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
  );
};

// ─── 14. Bulk upsert ─────────────────────────────────────────────────────────

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
        const result = await Lead.findOneAndUpdate(
          { clientCode, phone: input.phone },
          {
            $set: {
              firstName: input.firstName,
              lastName: input.lastName ?? "",
              email: input.email ?? null,
              source: input.source ?? "other",
              dealValue: input.dealValue ?? 0,
              dealTitle: input.dealTitle ?? "",
              assignedTo: input.assignedTo ?? null,
              "metadata.extra": input.metadata?.extra ?? {},
            },
            $setOnInsert: {
              clientCode,
              phone: input.phone,
              pipelineId: new mongoose.Types.ObjectId(
                input.pipelineId ?? defaultPipeline._id.toString(),
              ),
              stageId: new mongoose.Types.ObjectId(
                input.stageId ?? defaultStage._id.toString(),
              ),
              status: "open",
              tags: input.tags ?? [],
              "metadata.refs": metadataRefs,
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
  refs: Record<string, string | undefined> | undefined,
): Record<string, mongoose.Types.ObjectId> {
  if (!refs) return {};
  const result: Record<string, mongoose.Types.ObjectId> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (!value) continue;
    if (mongoose.Types.ObjectId.isValid(value))
      result[key] = new mongoose.Types.ObjectId(value);
  }
  return result;
}
