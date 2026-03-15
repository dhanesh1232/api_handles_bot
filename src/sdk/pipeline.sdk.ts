/**
 * PipelineSDK
 *
 * Class facade over pipeline.service.ts.
 * Bind to a clientCode once; call methods without repeating it.
 *
 * @example
 *   const pipeline = new PipelineSDK(clientCode);
 *   const all = await pipeline.list();
 *   await pipeline.addStage(pipelineId, { name: "Proposal", color: "#f59e0b" });
 */

import {
  addStage,
  archivePipeline,
  checkPipelineInUse,
  createPipeline,
  deleteStage,
  duplicatePipeline,
  getBoardSummary,
  getDefaultPipeline,
  getDefaultStage,
  getPipelines,
  getPipelineWithStages,
  getRevenueForecast,
  hardDeletePipeline,
  reorderStages,
  setDefaultPipeline,
  updatePipeline,
  updateStage,
} from "@services/saas/crm/pipeline.service";

export class PipelineSDK {
  constructor(private readonly clientCode: string) {}

  // ── Pipeline CRUD ─────────────────────────────────────────────────────────

  /** List all active pipelines (with their stages). */
  list(): Promise<any[]> {
    return getPipelines(this.clientCode);
  }

  /** Get a single pipeline + its ordered stages. */
  get(
    pipelineId: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> {
    return getPipelineWithStages(this.clientCode, pipelineId);
  }

  /** Alias for get() — preferred in route handlers for clarity. */
  getWithStages(
    pipelineId: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> {
    return getPipelineWithStages(this.clientCode, pipelineId);
  }

  /**
   * Create a new pipeline.
   * Pass a templateKey to bootstrap stages from a preset
   * (e.g. "sales", "appointment", "real_estate").
   */
  create(
    input: CreatePipelineInput,
    template?: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> {
    return createPipeline(this.clientCode, input, template as any);
  }

  /** Update pipeline name / description / order. */
  update(
    pipelineId: string,
    updates: Partial<Pick<IPipeline, "name" | "description" | "order">>,
  ): Promise<IPipeline | null> {
    return updatePipeline(this.clientCode, pipelineId, updates);
  }

  /** Mark a pipeline as the account default. */
  setDefault(pipelineId: string): Promise<void> {
    return setDefaultPipeline(this.clientCode, pipelineId);
  }

  /** Returns { inUse, leadCount } — gate for archive/delete. */
  checkInUse(
    pipelineId: string,
  ): Promise<{ inUse: boolean; leadCount: number }> {
    return checkPipelineInUse(this.clientCode, pipelineId);
  }

  /** Soft-archive a pipeline (marks isActive: false). Throws if leads exist. */
  archive(pipelineId: string): Promise<void> {
    return archivePipeline(this.clientCode, pipelineId);
  }

  /** Hard-delete a pipeline + its stages. Throws if leads exist. */
  hardDelete(pipelineId: string): Promise<void> {
    return hardDeletePipeline(this.clientCode, pipelineId);
  }

  /** Clone a pipeline under a new name. */
  duplicate(
    sourcePipelineId: string,
    newName: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> {
    return duplicatePipeline(this.clientCode, sourcePipelineId, newName);
  }

  /** Get the default (or first active) pipeline. */
  getDefault(): Promise<IPipeline | null> {
    return getDefaultPipeline(this.clientCode);
  }

  // ── Stage helpers ─────────────────────────────────────────────────────────

  /** Get the default (or first) entry stage in a pipeline. */
  getDefaultStage(pipelineId: string): Promise<IPipelineStage | null> {
    return getDefaultStage(this.clientCode, pipelineId);
  }

  /** Append (or insert) a new stage into a pipeline. */
  addStage(
    pipelineId: string,
    input: {
      name: string;
      color?: string;
      probability?: number;
      isWon?: boolean;
      isLost?: boolean;
      insertAfterOrder?: number;
    },
  ): Promise<IPipelineStage> {
    return addStage(this.clientCode, pipelineId, input);
  }

  /** Update stage metadata (name, color, probability, isWon, isLost, autoActions). */
  updateStage(
    stageId: string,
    updates: Partial<
      Pick<
        IPipelineStage,
        "name" | "color" | "probability" | "isWon" | "isLost" | "autoActions"
      >
    >,
  ): Promise<IPipelineStage | null> {
    return updateStage(this.clientCode, stageId, updates);
  }

  /** Bulk-reorder stages in a pipeline. */
  reorderStages(
    pipelineId: string,
    newOrder: UpdateStageOrderInput[],
  ): Promise<void> {
    return reorderStages(this.clientCode, pipelineId, newOrder);
  }

  /**
   * Delete a stage.
   * If leads exist in the stage, pass `moveLeadsToStageId` or it throws.
   */
  deleteStage(stageId: string, moveLeadsToStageId?: string): Promise<void> {
    return deleteStage(this.clientCode, stageId, moveLeadsToStageId);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  /** Kanban board summary: lead count + total value per stage. */
  board(pipelineId: string): Promise<BoardColumn[]> {
    return getBoardSummary(this.clientCode, pipelineId);
  }

  /** Revenue forecast: expected revenue per stage by probability. */
  forecast(pipelineId: string): Promise<ForecastRow[]> {
    return getRevenueForecast(this.clientCode, pipelineId);
  }
}
