/**
 * pipelineService.ts
 *
 * All pipeline + stage operations for the CRM.
 * Every function takes `clientCode` as its first param — tenant isolation.
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import mongoose from "mongoose";
import { getPipelineRepo, getPipelineStageRepo } from "./pipeline.repository";

// ─── Default stage templates ───────────────────────────────────────────────────

const DEFAULT_STAGE_TEMPLATES: Record<
  string,
  Array<{
    name: string;
    color: string;
    probability: number;
    isWon?: boolean;
    isLost?: boolean;
  }>
> = {
  // ─── Sales & CRM ──────────────────────────────────────────────────────────
  sales: [
    { name: "New Lead", color: "#6366f1", probability: 10 },
    { name: "Contacted", color: "#3b82f6", probability: 25 },
    { name: "Qualified", color: "#06b6d4", probability: 40 },
    { name: "Proposal Sent", color: "#f59e0b", probability: 60 },
    { name: "Negotiation", color: "#f97316", probability: 80 },
    { name: "Won", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],
  marketing: [
    { name: "Awareness", color: "#6366f1", probability: 5 },
    { name: "Interest", color: "#3b82f6", probability: 20 },
    { name: "Engaged", color: "#06b6d4", probability: 35 },
    { name: "Lead Captured", color: "#f59e0b", probability: 55 },
    { name: "Nurturing", color: "#f97316", probability: 70 },
    { name: "Converted", color: "#10b981", probability: 100, isWon: true },
    { name: "Disqualified", color: "#ef4444", probability: 0, isLost: true },
  ],
  product_purchase: [
    { name: "Browsing", color: "#6366f1", probability: 10 },
    { name: "Interested", color: "#3b82f6", probability: 25 },
    { name: "Add to Cart", color: "#06b6d4", probability: 50 },
    { name: "Checkout", color: "#f59e0b", probability: 75 },
    { name: "Purchased", color: "#10b981", probability: 100, isWon: true },
    { name: "Abandoned", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Healthcare & Wellness ─────────────────────────────────────────────────
  appointment: [
    { name: "Inquiry", color: "#6366f1", probability: 15 },
    { name: "Appointment Scheduled", color: "#3b82f6", probability: 40 },
    { name: "Reminder Sent", color: "#06b6d4", probability: 55 },
    {
      name: "Appointment Completed",
      color: "#10b981",
      probability: 100,
      isWon: true,
    },
    { name: "Rescheduled", color: "#f59e0b", probability: 40 },
    { name: "No Show", color: "#f97316", probability: 10 },
    { name: "Cancelled", color: "#ef4444", probability: 0, isLost: true },
  ],
  patient_journey: [
    { name: "Enquiry", color: "#6366f1", probability: 10 },
    { name: "Consultation Booked", color: "#3b82f6", probability: 30 },
    { name: "Consultation Done", color: "#06b6d4", probability: 50 },
    { name: "Treatment Plan Shared", color: "#f59e0b", probability: 65 },
    { name: "Treatment Started", color: "#f97316", probability: 80 },
    {
      name: "Treatment Completed",
      color: "#10b981",
      probability: 100,
      isWon: true,
    },
    { name: "Dropped", color: "#ef4444", probability: 0, isLost: true },
  ],
  wellness: [
    { name: "Lead", color: "#6366f1", probability: 10 },
    { name: "Free Session Booked", color: "#3b82f6", probability: 30 },
    { name: "Free Session Done", color: "#06b6d4", probability: 50 },
    { name: "Package Proposed", color: "#f59e0b", probability: 65 },
    {
      name: "Package Purchased",
      color: "#10b981",
      probability: 100,
      isWon: true,
    },
    { name: "Not Interested", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Education & Coaching ──────────────────────────────────────────────────
  admissions: [
    { name: "Enquiry", color: "#6366f1", probability: 10 },
    { name: "Application Received", color: "#3b82f6", probability: 30 },
    { name: "Under Review", color: "#06b6d4", probability: 50 },
    { name: "Interview Scheduled", color: "#8b5cf6", probability: 65 },
    { name: "Offer Letter Sent", color: "#f59e0b", probability: 80 },
    { name: "Enrolled", color: "#10b981", probability: 100, isWon: true },
    { name: "Rejected", color: "#ef4444", probability: 0, isLost: true },
    { name: "Deferred", color: "#6b7280", probability: 20 },
  ],
  coaching: [
    { name: "Discovery Call", color: "#6366f1", probability: 15 },
    { name: "Assessment", color: "#3b82f6", probability: 30 },
    { name: "Proposal Shared", color: "#06b6d4", probability: 50 },
    { name: "Trial Session", color: "#f59e0b", probability: 70 },
    { name: "Enrolled", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Real Estate ───────────────────────────────────────────────────────────
  real_estate: [
    { name: "Inquiry", color: "#6366f1", probability: 10 },
    { name: "Site Visit Scheduled", color: "#3b82f6", probability: 25 },
    { name: "Site Visit Done", color: "#06b6d4", probability: 45 },
    { name: "Shortlisted", color: "#8b5cf6", probability: 60 },
    { name: "Token Paid", color: "#f59e0b", probability: 75 },
    { name: "Agreement Signed", color: "#f97316", probability: 90 },
    { name: "Closed", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Recruitment & HR ─────────────────────────────────────────────────────
  recruitment: [
    { name: "Applied", color: "#6366f1", probability: 10 },
    { name: "Screening", color: "#3b82f6", probability: 25 },
    { name: "Technical Round", color: "#8b5cf6", probability: 45 },
    { name: "HR Interview", color: "#06b6d4", probability: 65 },
    { name: "Offer Extended", color: "#f59e0b", probability: 80 },
    { name: "Hired", color: "#10b981", probability: 100, isWon: true },
    { name: "Rejected", color: "#ef4444", probability: 0, isLost: true },
    { name: "On Hold", color: "#6b7280", probability: 20 },
  ],

  // ─── Customer Support ──────────────────────────────────────────────────────
  support: [
    { name: "Open", color: "#6366f1", probability: 0 },
    { name: "Assigned", color: "#3b82f6", probability: 20 },
    { name: "In Progress", color: "#f59e0b", probability: 50 },
    { name: "Waiting on Customer", color: "#f97316", probability: 50 },
    { name: "Resolved", color: "#10b981", probability: 100, isWon: true },
    { name: "Closed", color: "#6b7280", probability: 100, isLost: true },
  ],

  // ─── SaaS & Tech ───────────────────────────────────────────────────────────
  saas_trial: [
    { name: "Signed Up", color: "#6366f1", probability: 10 },
    { name: "Onboarding", color: "#3b82f6", probability: 25 },
    { name: "Active Trial", color: "#06b6d4", probability: 45 },
    { name: "Demo Scheduled", color: "#8b5cf6", probability: 60 },
    { name: "Demo Done", color: "#f59e0b", probability: 75 },
    { name: "Converted", color: "#10b981", probability: 100, isWon: true },
    { name: "Churned", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Events & Webinars ─────────────────────────────────────────────────────
  event: [
    { name: "Registered", color: "#6366f1", probability: 20 },
    { name: "Reminder Sent", color: "#3b82f6", probability: 40 },
    { name: "Attended", color: "#10b981", probability: 100, isWon: true },
    { name: "No Show", color: "#f97316", probability: 10 },
    { name: "Followed Up", color: "#06b6d4", probability: 60 },
    { name: "Converted", color: "#8b5cf6", probability: 80 },
    { name: "Unsubscribed", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Legal & Consulting ────────────────────────────────────────────────────
  legal: [
    { name: "Inquiry", color: "#6366f1", probability: 10 },
    { name: "Initial Consultation", color: "#3b82f6", probability: 30 },
    { name: "Documents Collected", color: "#06b6d4", probability: 50 },
    { name: "Case Filed", color: "#8b5cf6", probability: 65 },
    { name: "Under Review", color: "#f59e0b", probability: 75 },
    { name: "Resolved / Won", color: "#10b981", probability: 100, isWon: true },
    { name: "Closed / Lost", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Insurance ─────────────────────────────────────────────────────────────
  insurance: [
    { name: "Lead", color: "#6366f1", probability: 10 },
    { name: "Needs Analysis", color: "#3b82f6", probability: 25 },
    { name: "Quotation Sent", color: "#06b6d4", probability: 45 },
    { name: "Proposal Reviewed", color: "#f59e0b", probability: 65 },
    { name: "Policy Issued", color: "#10b981", probability: 100, isWon: true },
    { name: "Declined", color: "#ef4444", probability: 0, isLost: true },
    { name: "Lapsed", color: "#6b7280", probability: 0, isLost: true },
  ],

  // ─── E-Commerce / D2C ─────────────────────────────────────────────────────
  ecommerce: [
    { name: "Visitor", color: "#6366f1", probability: 5 },
    { name: "Product Viewed", color: "#3b82f6", probability: 15 },
    { name: "Wishlist Added", color: "#06b6d4", probability: 30 },
    { name: "Cart Added", color: "#8b5cf6", probability: 55 },
    { name: "Payment Initiated", color: "#f59e0b", probability: 75 },
    { name: "Order Placed", color: "#10b981", probability: 100, isWon: true },
    { name: "Abandoned", color: "#ef4444", probability: 0, isLost: true },
  ],

  // ─── Custom (blank) ────────────────────────────────────────────────────────
  custom: [],
};

// ─── 1. Get all pipelines ─────────────────────────────────────────────────────
/**
 * @description This function is used to get all pipelines.
 * @param {string} clientCode - The client code.
 * @returns {Promise<any[]>} The list of pipelines.
 */
export const getPipelines = async (clientCode: string): Promise<any[]> => {
  const pRepo = await getPipelineRepo(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);

  const pipelines = await pRepo.findActive();
  const stages = await sRepo.findMany({});

  return pipelines.map((p: any) => ({
    ...p,
    stages: stages.filter(
      (s: any) => s.pipelineId.toString() === p._id.toString(),
    ),
  }));
};

// ─── 2. Get a single pipeline with its stages ─────────────────────────────────
/**
 * @description This function is used to get a single pipeline with its stages.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null>} The pipeline with its stages.
 */
export const getPipelineWithStages = async (
  clientCode: string,
  pipelineId: string,
): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> => {
  const pRepo = await getPipelineRepo(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);

  const pipeline = await pRepo.findOne({ _id: pipelineId, isActive: true });
  if (!pipeline) return null;

  const stages = await sRepo.findByPipeline(pipelineId);
  return { pipeline, stages };
};

// ─── 3. Create pipeline + stages ─────────────────────────────────────────────
/**
 * @description This function is used to create a new pipeline with its stages.
 * @param {string} clientCode - The client code.
 * @param {CreatePipelineInput} input - The data to create the pipeline.
 * @param {keyof typeof DEFAULT_STAGE_TEMPLATES} [templateKey] - The template key.
 * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }>} The created pipeline with its stages.
 */
export const createPipeline = async (
  clientCode: string,
  input: CreatePipelineInput,
  templateKey?: keyof typeof DEFAULT_STAGE_TEMPLATES,
): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> => {
  const pRepo = await getPipelineRepo(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);

  if (input.isDefault) {
    await pRepo.updateMany({}, { isDefault: false });
  }

  const existingCount = await pRepo.count({});
  const shouldBeDefault = input.isDefault ?? existingCount === 0;

  const pipeline = await pRepo.create({
    name: input.name,
    description: input.description ?? "",
    isDefault: shouldBeDefault,
    order: existingCount,
  });

  const rawStages =
    input.stages.length > 0
      ? input.stages
      : (DEFAULT_STAGE_TEMPLATES[templateKey ?? "sales"] ??
        DEFAULT_STAGE_TEMPLATES.sales);

  const stageDocuments = rawStages.map((s, idx) => ({
    clientCode,
    pipelineId: pipeline._id,
    name: s.name,
    color: s.color ?? "#3b82f6",
    order: idx,
    probability: s.probability ?? 0,
    isDefault: idx === 0,
    isWon: s.isWon ?? false,
    isLost: s.isLost ?? false,
    autoActions: [],
  }));

  const stages = await sRepo.createMany(stageDocuments);
  return { pipeline, stages };
};

// ─── 4. Update pipeline metadata ─────────────────────────────────────────────
/**
 * @description This function is used to update the pipeline metadata.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @param {Partial<Pick<IPipeline, "name" | "description" | "order">>} updates - The updates to apply to the pipeline.
 * @returns {Promise<IPipeline | null>} The updated pipeline.
 */
export const updatePipeline = async (
  clientCode: string,
  pipelineId: string,
  updates: Partial<Pick<IPipeline, "name" | "description" | "order">>,
): Promise<IPipeline | null> => {
  const repo = await getPipelineRepo(clientCode);
  return repo.update(pipelineId, { $set: updates });
};

// ─── 5. Set default pipeline ─────────────────────────────────────────────────
/**
 * @description This function is used to set the default pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<void>}
 */
export const setDefaultPipeline = async (
  clientCode: string,
  pipelineId: string,
): Promise<void> => {
  const repo = await getPipelineRepo(clientCode);
  await repo.updateMany({}, { $set: { isDefault: false } });
  await repo.update(pipelineId, { $set: { isDefault: true } });
};

// ─── 6. Check if pipeline is in use ─────────────────────────────────────────
/**
 * @description This function is used to check if the pipeline is in use.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<{ inUse: boolean; leadCount: number }>}
 */
export const checkPipelineInUse = async (
  clientCode: string,
  pipelineId: string,
): Promise<{ inUse: boolean; leadCount: number }> => {
  const { Lead } = await getCrmModels(clientCode); // Lead repo not used here for simplicity as it's a cross-service check
  const leadCount = await Lead.countDocuments({
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  });
  return { inUse: leadCount > 0, leadCount };
};

// ─── 7. Soft archive pipeline (isActive: false) ───────────────────────────────
/**
 * @description This function is used to archive the pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<void>}
 */
export const archivePipeline = async (
  clientCode: string,
  pipelineId: string,
): Promise<void> => {
  const repo = await getPipelineRepo(clientCode);
  const pipeline = await repo.findById(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.isDefault)
    throw new Error("Cannot archive the default pipeline");
  const { leadCount } = await checkPipelineInUse(clientCode, pipelineId);
  if (leadCount > 0)
    throw new Error(
      `Cannot archive: ${leadCount} lead(s) are assigned to this pipeline. Reassign them first.`,
    );
  await repo.update(pipelineId, { $set: { isActive: false } });
};

// ─── 8. Hard delete pipeline (permanent) ─────────────────────────────────────
/**
 * @description This function is used to permanently delete the pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<void>}
 */
export const hardDeletePipeline = async (
  clientCode: string,
  pipelineId: string,
): Promise<void> => {
  const pRepo = await getPipelineRepo(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);

  const pipeline = await pRepo.findById(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.isDefault) throw new Error("Cannot delete the default pipeline");
  const { leadCount } = await checkPipelineInUse(clientCode, pipelineId);
  if (leadCount > 0)
    throw new Error(
      `Cannot delete: ${leadCount} lead(s) are assigned to this pipeline. Reassign them first.`,
    );
  await sRepo.deleteMany({
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  });
  await pRepo.delete(pipelineId);
};

// ─── 7. Add a stage ──────────────────────────────────────────────────────────
/**
 * @description This function is used to add a new stage to the pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @param {
 *   name: string;
 *   color?: string;
 *   probability?: number;
 *   isWon?: boolean;
 *   isLost?: boolean;
 *   insertAfterOrder?: number;
 * } input - The data to add the stage.
 * @returns {Promise<IPipelineStage>}
 */
export const addStage = async (
  clientCode: string,
  pipelineId: string,
  input: {
    name: string;
    color?: string;
    probability?: number;
    isWon?: boolean;
    isLost?: boolean;
    insertAfterOrder?: number;
  },
): Promise<IPipelineStage> => {
  const { Pipeline, PipelineStage } = await getCrmModels(clientCode);
  const pipeline = await Pipeline.findOne({
    _id: pipelineId,
    clientCode,
  }).lean();
  if (!pipeline) throw new Error("Pipeline not found");

  const sRepo = await getPipelineStageRepo(clientCode);
  const lastStage = await sRepo.findOne(
    { pipelineId: new mongoose.Types.ObjectId(pipelineId) },
    { sort: { order: -1 } },
  );

  const newOrder =
    input.insertAfterOrder !== undefined
      ? input.insertAfterOrder + 1
      : (lastStage?.order ?? -1) + 1;

  if (input.insertAfterOrder !== undefined) {
    await sRepo.updateMany(
      {
        pipelineId: new mongoose.Types.ObjectId(pipelineId),
        order: { $gte: newOrder },
      },
      { $inc: { order: 1 } },
    );
  }

  return sRepo.create({
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
    name: input.name,
    color: input.color ?? "#3b82f6",
    order: newOrder,
    probability: input.probability ?? 0,
    isDefault: false,
    isWon: input.isWon ?? false,
    isLost: input.isLost ?? false,
    autoActions: [],
  });
};

// ─── 8. Update a stage ───────────────────────────────────────────────────────
/**
 * @description This function is used to update a stage.
 * @param {string} clientCode - The client code.
 * @param {string} stageId - The ID of the stage.
 * @param {Partial<Pick<IPipelineStage, "name" | "color" | "probability" | "isWon" | "isLost" | "autoActions">>} updates - The updates to apply to the stage.
 * @returns {Promise<IPipelineStage | null>}
 */
export const updateStage = async (
  clientCode: string,
  stageId: string,
  updates: Partial<
    Pick<
      IPipelineStage,
      "name" | "color" | "probability" | "isWon" | "isLost" | "autoActions"
    >
  >,
): Promise<IPipelineStage | null> => {
  const sRepo = await getPipelineStageRepo(clientCode);
  return sRepo.update(stageId, { $set: updates });
};

// ─── 9. Reorder all stages ───────────────────────────────────────────────────
/**
 * @description This function is used to reorder the stages in the pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @param {UpdateStageOrderInput[]} newOrder - The new order of the stages.
 * @returns {Promise<void>}
 */
export const reorderStages = async (
  clientCode: string,
  _pipelineId: string,
  newOrder: UpdateStageOrderInput[],
): Promise<void> => {
  const sRepo = await getPipelineStageRepo(clientCode);
  await Promise.all(
    newOrder.map(({ stageId, newOrder: order }) =>
      sRepo.update(stageId, { $set: { order } }),
    ),
  );
};

// ─── 10. Delete a stage ──────────────────────────────────────────────────────
/**
 * @description This function is used to delete a stage.
 * @param {string} clientCode - The client code.
 * @param {string} stageId - The ID of the stage.
 * @param {string} [moveLeadsToStageId] - The ID of the stage to move leads to.
 * @returns {Promise<void>}
 */
export const deleteStage = async (
  clientCode: string,
  stageId: string,
  moveLeadsToStageId?: string,
): Promise<void> => {
  const { Lead } = await getCrmModels(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);

  const stage = await sRepo.findById(stageId);
  if (!stage) throw new Error("Stage not found");

  const leadCount = await Lead.countDocuments({ clientCode, stageId });
  if (leadCount > 0 && !moveLeadsToStageId) {
    throw new Error(
      `${leadCount} leads are in this stage. Provide moveLeadsToStageId to migrate them first.`,
    );
  }
  if (leadCount > 0 && moveLeadsToStageId) {
    const targetStage = await sRepo.findById(moveLeadsToStageId);
    if (!targetStage) throw new Error("Target stage not found");
    await Lead.updateMany(
      { clientCode, stageId },
      { $set: { stageId: moveLeadsToStageId } },
    );
  }
  await sRepo.delete(stageId);
};

// ─── 11. Board summary (Kanban) ──────────────────────────────────────────────
/**
 * @description This function is used to get the board summary.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<BoardColumn[]>}
 */
export const getBoardSummary = async (
  clientCode: string,
  pipelineId: string,
): Promise<BoardColumn[]> => {
  const { Lead } = await getCrmModels(clientCode);
  const sRepo = await getPipelineStageRepo(clientCode);
  const stages = await sRepo.findByPipeline(pipelineId);
  if (stages.length === 0) return [];

  const agg = await Lead.aggregate([
    {
      $match: {
        clientCode,
        pipelineId: new mongoose.Types.ObjectId(pipelineId),
        isArchived: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$stageId",
        leadCount: { $sum: 1 },
        totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
      },
    },
  ]);

  const statsMap = new Map(agg.map((row: any) => [row._id.toString(), row]));
  return stages.map((stage) => {
    const stats: any = statsMap.get(stage._id.toString());
    return {
      stage,
      leadCount: stats?.leadCount ?? 0,
      totalValue: stats?.totalValue ?? 0,
    };
  });
};

// ─── 12. Revenue forecast ────────────────────────────────────────────────────
/**
 * @description This function is used to get the revenue forecast.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<ForecastRow[]>}
 */
// ForecastRow moved to global.d.ts
export const getRevenueForecast = async (
  clientCode: string,
  pipelineId: string,
): Promise<ForecastRow[]> => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);
  const stages = await PipelineStage.find({
    clientCode,
    pipelineId,
    isLost: false,
  }).sort({ order: 1 });
  if (stages.length === 0) return [];

  const agg = await Lead.aggregate([
    {
      $match: {
        clientCode,
        pipelineId: new mongoose.Types.ObjectId(pipelineId),
        status: "open",
        isArchived: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$stageId",
        totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
        leadCount: { $sum: 1 },
      },
    },
  ]);

  const statsMap = new Map(agg.map((r: any) => [r._id.toString(), r]));
  return stages.map((stage: IPipelineStage) => {
    const stats: any = statsMap.get(stage._id.toString());
    const totalValue = stats?.totalValue ?? 0;
    return {
      stageId: stage._id.toString(),
      stageName: stage.name,
      probability: stage.probability,
      totalValue,
      expectedRevenue: Math.round((totalValue * stage.probability) / 100),
      leadCount: stats?.leadCount ?? 0,
    };
  });
};

// ─── 13. Get default entry stage ─────────────────────────────────────────────
/**
 * @description This function is used to get the default entry stage.
 * @param {string} clientCode - The client code.
 * @param {string} pipelineId - The ID of the pipeline.
 * @returns {Promise<IPipelineStage | null>}
 */
export const getDefaultStage = async (
  clientCode: string,
  pipelineId: string,
): Promise<IPipelineStage | null> => {
  const { PipelineStage } = await getCrmModels(clientCode);
  return (
    (await PipelineStage.findOne({
      clientCode,
      pipelineId,
      isDefault: true,
    }).lean()) ??
    (await PipelineStage.findOne({ clientCode, pipelineId })
      .sort({ order: 1 })
      .lean())
  );
};

// ─── 14. Get default pipeline ─────────────────────────────────────────────────
/**
 * @description This function is used to get the default pipeline.
 * @param {string} clientCode - The client code.
 * @returns {Promise<IPipeline | null>}
 */
export const getDefaultPipeline = async (
  clientCode: string,
): Promise<IPipeline | null> => {
  const { Pipeline } = await getCrmModels(clientCode);
  return (
    (await Pipeline.findOne({
      clientCode,
      isDefault: true,
      isActive: true,
    }).lean()) ??
    (await Pipeline.findOne({ clientCode, isActive: true })
      .sort({
        createdAt: 1,
      })
      .lean())
  );
};

// ─── 15. Duplicate a pipeline ─────────────────────────────────────────────────
/**
 * @description This function is used to duplicate a pipeline.
 * @param {string} clientCode - The client code.
 * @param {string} sourcePipelineId - The ID of the source pipeline.
 * @param {string} newName - The name of the new pipeline.
 * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }>}
 */
export const duplicatePipeline = async (
  clientCode: string,
  sourcePipelineId: string,
  newName: string,
): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> => {
  const source = await getPipelineWithStages(clientCode, sourcePipelineId);
  if (!source) throw new Error("Source pipeline not found");
  return createPipeline(clientCode, {
    name: newName,
    description: source.pipeline.description,
    isDefault: false,
    stages: source.stages.map((s) => ({
      name: s.name,
      color: s.color,
      probability: s.probability,
      isWon: s.isWon,
      isLost: s.isLost,
    })),
  });
};
