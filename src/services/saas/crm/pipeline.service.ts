/**
 * pipelineService.ts
 *
 * All pipeline + stage operations for the CRM.
 * Every function takes `clientCode` as its first param — tenant isolation.
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import mongoose from "mongoose";
import { getCrmModels } from "../../../lib/tenant/getCrmModels.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatePipelineInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  stages: Array<{
    name: string;
    color?: string;
    probability?: number;
    isDefault?: boolean;
    isWon?: boolean;
    isLost?: boolean;
  }>;
}

export interface UpdateStageOrderInput {
  stageId: string;
  newOrder: number;
}

export interface BoardColumn {
  stage: IPipelineStage;
  leadCount: number;
  totalValue: number;
}

export interface ForecastRow {
  stageId: string;
  stageName: string;
  probability: number;
  totalValue: number;
  expectedRevenue: number;
  leadCount: number;
}

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
  sales: [
    { name: "New Lead", color: "#6366f1", probability: 10 },
    { name: "Contacted", color: "#3b82f6", probability: 25 },
    { name: "Qualified", color: "#06b6d4", probability: 40 },
    { name: "Proposal", color: "#f59e0b", probability: 60 },
    { name: "Negotiation", color: "#f97316", probability: 80 },
    { name: "Won", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],
  support: [
    { name: "Open", color: "#6366f1", probability: 0 },
    { name: "In Progress", color: "#f59e0b", probability: 50 },
    { name: "Waiting", color: "#f97316", probability: 50 },
    { name: "Resolved", color: "#10b981", probability: 100, isWon: true },
    { name: "Closed", color: "#6b7280", probability: 100, isLost: true },
  ],
  recruitment: [
    { name: "Applied", color: "#6366f1", probability: 10 },
    { name: "Screening", color: "#3b82f6", probability: 25 },
    { name: "Interview", color: "#8b5cf6", probability: 50 },
    { name: "Offer", color: "#f59e0b", probability: 75 },
    { name: "Hired", color: "#10b981", probability: 100, isWon: true },
    { name: "Rejected", color: "#ef4444", probability: 0, isLost: true },
  ],
  marketing: [
    { name: "New Lead", color: "#6366f1", probability: 10 },
    { name: "Contacted", color: "#3b82f6", probability: 25 },
    { name: "Qualified", color: "#06b6d4", probability: 40 },
    { name: "Proposal", color: "#f59e0b", probability: 60 },
    { name: "Negotiation", color: "#f97316", probability: 80 },
    { name: "Won", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],
  appointment: [
    { name: "New Lead", color: "#6366f1", probability: 10 },
    { name: "Appointment Scheduled", color: "#3b82f6", probability: 25 },
    { name: "Appointment Completed", color: "#06b6d4", probability: 40 },
    { name: "Appointment Cancelled", color: "#f59e0b", probability: 60 },
    { name: "Appointment Rescheduled", color: "#f97316", probability: 80 },
    {
      name: "Appointment No Show",
      color: "#10b981",
      probability: 100,
      isWon: true,
    },
    {
      name: "Appointment Follow Up",
      color: "#ef4444",
      probability: 0,
      isLost: true,
    },
  ],
  product_purchase: [
    { name: "New Lead", color: "#6366f1", probability: 10 },
    { name: "Contacted", color: "#3b82f6", probability: 25 },
    { name: "Qualified", color: "#06b6d4", probability: 40 },
    { name: "Proposal", color: "#f59e0b", probability: 60 },
    { name: "Negotiation", color: "#f97316", probability: 80 },
    { name: "Won", color: "#10b981", probability: 100, isWon: true },
    { name: "Lost", color: "#ef4444", probability: 0, isLost: true },
  ],
};

// ─── 1. Get all pipelines ─────────────────────────────────────────────────────

export const getPipelines = async (clientCode: string): Promise<any[]> => {
  const { Pipeline, PipelineStage } = await getCrmModels(clientCode);
  const pipelines = await Pipeline.find({ clientCode, isActive: true })
    .sort({ order: 1 })
    .lean();
  const stages = await PipelineStage.find({ clientCode })
    .sort({ order: 1 })
    .lean();

  return pipelines.map((p: any) => ({
    ...p,
    stages: stages.filter(
      (s: any) => s.pipelineId.toString() === p._id.toString(),
    ),
  }));
};

// ─── 2. Get a single pipeline with its stages ─────────────────────────────────

export const getPipelineWithStages = async (
  clientCode: string,
  pipelineId: string,
): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> => {
  const { Pipeline, PipelineStage } = await getCrmModels(clientCode);
  const pipeline = await Pipeline.findOne({
    _id: pipelineId,
    clientCode,
    isActive: true,
  });
  if (!pipeline) return null;
  const stages = await PipelineStage.find({
    clientCode,
    pipelineId: pipeline._id,
  }).sort({ order: 1 });
  return { pipeline, stages };
};

// ─── 3. Create pipeline + stages ─────────────────────────────────────────────

export const createPipeline = async (
  clientCode: string,
  input: CreatePipelineInput,
  templateKey?: keyof typeof DEFAULT_STAGE_TEMPLATES,
): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> => {
  const { Pipeline, PipelineStage } = await getCrmModels(clientCode);

  if (input.isDefault) {
    await Pipeline.updateMany({ clientCode }, { isDefault: false });
  }

  const existingCount = await Pipeline.countDocuments({ clientCode });
  const shouldBeDefault = input.isDefault ?? existingCount === 0;

  const pipeline = await Pipeline.create({
    clientCode,
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

  const stages = await PipelineStage.insertMany(stageDocuments);
  return { pipeline, stages: stages as unknown as IPipelineStage[] };
};

// ─── 4. Update pipeline metadata ─────────────────────────────────────────────

export const updatePipeline = async (
  clientCode: string,
  pipelineId: string,
  updates: Partial<Pick<IPipeline, "name" | "description" | "order">>,
): Promise<IPipeline | null> => {
  const { Pipeline } = await getCrmModels(clientCode);
  return Pipeline.findOneAndUpdate(
    { _id: pipelineId, clientCode },
    { $set: updates },
    { new: true },
  );
};

// ─── 5. Set default pipeline ─────────────────────────────────────────────────

export const setDefaultPipeline = async (
  clientCode: string,
  pipelineId: string,
): Promise<void> => {
  const { Pipeline } = await getCrmModels(clientCode);
  await Pipeline.updateMany({ clientCode }, { $set: { isDefault: false } });
  await Pipeline.findOneAndUpdate(
    { _id: pipelineId, clientCode },
    { $set: { isDefault: true } },
  );
};

// ─── 6. Soft delete pipeline ─────────────────────────────────────────────────

export const archivePipeline = async (
  clientCode: string,
  pipelineId: string,
): Promise<void> => {
  const { Pipeline } = await getCrmModels(clientCode);
  const pipeline = await Pipeline.findOne({ _id: pipelineId, clientCode });
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.isDefault)
    throw new Error("Cannot archive the default pipeline");
  await Pipeline.findByIdAndUpdate(pipelineId, { $set: { isActive: false } });
};

// ─── 7. Add a stage ──────────────────────────────────────────────────────────

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
  const pipeline = await Pipeline.findOne({ _id: pipelineId, clientCode });
  if (!pipeline) throw new Error("Pipeline not found");

  const lastStage = await PipelineStage.findOne({ clientCode, pipelineId })
    .sort({ order: -1 })
    .select("order");
  const newOrder =
    input.insertAfterOrder !== undefined
      ? input.insertAfterOrder + 1
      : (lastStage?.order ?? -1) + 1;

  if (input.insertAfterOrder !== undefined) {
    await PipelineStage.updateMany(
      { clientCode, pipelineId, order: { $gte: newOrder } },
      { $inc: { order: 1 } },
    );
  }

  return PipelineStage.create({
    clientCode,
    pipelineId,
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
  const { PipelineStage } = await getCrmModels(clientCode);
  return PipelineStage.findOneAndUpdate(
    { _id: stageId, clientCode },
    { $set: updates },
    { new: true },
  );
};

// ─── 9. Reorder all stages ───────────────────────────────────────────────────

export const reorderStages = async (
  clientCode: string,
  pipelineId: string,
  newOrder: UpdateStageOrderInput[],
): Promise<void> => {
  const { Pipeline, PipelineStage } = await getCrmModels(clientCode);
  const pipeline = await Pipeline.findOne({ _id: pipelineId, clientCode });
  if (!pipeline) throw new Error("Pipeline not found");
  await Promise.all(
    newOrder.map(({ stageId, newOrder: order }) =>
      PipelineStage.updateOne(
        { _id: stageId, clientCode, pipelineId },
        { $set: { order } },
      ),
    ),
  );
};

// ─── 10. Delete a stage ──────────────────────────────────────────────────────

export const deleteStage = async (
  clientCode: string,
  stageId: string,
  moveleadsToStageId?: string,
): Promise<void> => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);
  const stage = await PipelineStage.findOne({ _id: stageId, clientCode });
  if (!stage) throw new Error("Stage not found");

  const leadCount = await Lead.countDocuments({ clientCode, stageId });
  if (leadCount > 0 && !moveleadsToStageId) {
    throw new Error(
      `${leadCount} leads are in this stage. Provide moveleadsToStageId to migrate them first.`,
    );
  }
  if (leadCount > 0 && moveleadsToStageId) {
    const targetStage = await PipelineStage.findOne({
      _id: moveleadsToStageId,
      clientCode,
    });
    if (!targetStage) throw new Error("Target stage not found");
    await Lead.updateMany(
      { clientCode, stageId },
      { $set: { stageId: moveleadsToStageId } },
    );
  }
  await PipelineStage.deleteOne({ _id: stageId, clientCode });
};

// ─── 11. Board summary (Kanban) ──────────────────────────────────────────────

export const getBoardSummary = async (
  clientCode: string,
  pipelineId: string,
): Promise<BoardColumn[]> => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);
  const stages = await PipelineStage.find({ clientCode, pipelineId }).sort({
    order: 1,
  });
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
  return stages.map((stage) => {
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
    })) ?? PipelineStage.findOne({ clientCode, pipelineId }).sort({ order: 1 })
  );
};

// ─── 14. Get default pipeline ─────────────────────────────────────────────────

export const getDefaultPipeline = async (
  clientCode: string,
): Promise<IPipeline | null> => {
  const { Pipeline } = await getCrmModels(clientCode);
  return (
    (await Pipeline.findOne({ clientCode, isDefault: true, isActive: true })) ??
    Pipeline.findOne({ clientCode, isActive: true }).sort({ createdAt: 1 })
  );
};

// ─── 15. Duplicate a pipeline ─────────────────────────────────────────────────

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
