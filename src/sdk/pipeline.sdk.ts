/**
 * @file pipeline.sdk.ts
 * @module PipelineSDK
 * @responsibility Facade for managing multi-stage Kanban pipelines and sales forecasting.
 * @dependencies pipeline.service.ts
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

  /**
   * Retrieves all active pipelines for the current tenant.
   *
   * @returns {Promise<IPipeline[]>}
   */
  list(): Promise<any[]> {
    return getPipelines(this.clientCode);
  }

  /**
   * Fetches a specific pipeline along with its ordered stages.
   *
   * **WORKING PROCESS:**
   * 1. Performs a tenant-isolated lookup on the `Pipeline` collection.
   * 2. Joins or queries the `PipelineStage` collection for associated steps.
   * 3. Sorts stages by their `order` property.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null>}
   */
  get(
    pipelineId: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> {
    return getPipelineWithStages(this.clientCode, pipelineId);
  }

  /**
   * Identical to `get()`, used for explicit intent in board handlers.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null>}
   */
  getWithStages(
    pipelineId: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] } | null> {
    return getPipelineWithStages(this.clientCode, pipelineId);
  }

  /**
   * Initializes a new pipeline, optionally using a industry-standard preset.
   *
   * **WORKING PROCESS:**
   * 1. Creates the base `Pipeline` document.
   * 2. If a `template` is provided, bootstraps pre-defined stages (e.g., 'Real Estate', 'SaaS').
   * 3. Sets the first pipeline as `isDefault` if no other exists.
   *
   * @param {CreatePipelineInput} input - Name and optional configuration.
   * @param {string} [template] - Optional preset identifier.
   * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }>}
   */
  create(
    input: CreatePipelineInput,
    template?: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> {
    return createPipeline(this.clientCode, input, template as any);
  }

  /**
   * Updates pipeline-level metadata.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @param {Partial<Pick<IPipeline, "name" | "description" | "order">>} updates
   * @returns {Promise<IPipeline | null>}
   */
  update(
    pipelineId: string,
    updates: Partial<Pick<IPipeline, "name" | "description" | "order">>,
  ): Promise<IPipeline | null> {
    return updatePipeline(this.clientCode, pipelineId, updates);
  }

  /**
   * Sets the primary pipeline for the account.
   *
   * **WORKING PROCESS:**
   * 1. Unsets `isDefault` on all other pipelines for the tenant.
   * 2. Sets `isDefault: true` on the target pipeline.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<void>}
   */
  setDefault(pipelineId: string): Promise<void> {
    return setDefaultPipeline(this.clientCode, pipelineId);
  }

  /**
   * Safety check before archiving or deleting.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<{ inUse: boolean; leadCount: number }>}
   */
  checkInUse(
    pipelineId: string,
  ): Promise<{ inUse: boolean; leadCount: number }> {
    return checkPipelineInUse(this.clientCode, pipelineId);
  }

  /**
   * Soft-archives a pipeline, preventing its use without data loss.
   * Throws an error if active leads are still mapped to any stage in this pipeline.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<void>}
   */
  archive(pipelineId: string): Promise<void> {
    return archivePipeline(this.clientCode, pipelineId);
  }

  /**
   * Irreversibly deletes a pipeline and its associated stages.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<void>}
   */
  hardDelete(pipelineId: string): Promise<void> {
    return hardDeletePipeline(this.clientCode, pipelineId);
  }

  /**
   * Creates an exact replica of a pipeline under a new name.
   *
   * @param {string} sourcePipelineId - Original identifier.
   * @param {string} newName - Clone name.
   * @returns {Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }>}
   */
  duplicate(
    sourcePipelineId: string,
    newName: string,
  ): Promise<{ pipeline: IPipeline; stages: IPipelineStage[] }> {
    return duplicatePipeline(this.clientCode, sourcePipelineId, newName);
  }

  /**
   * Fetches the default or first active pipeline.
   *
   * @returns {Promise<IPipeline | null>}
   */
  getDefault(): Promise<IPipeline | null> {
    return getDefaultPipeline(this.clientCode);
  }

  // ── Stage helpers ─────────────────────────────────────────────────────────

  /**
   * Identifies the primary entry stage for a specific pipeline.
   *
   * @param {string} pipelineId - Parent pipeline identifier.
   * @returns {Promise<IPipelineStage | null>}
   */
  getDefaultStage(pipelineId: string): Promise<IPipelineStage | null> {
    return getDefaultStage(this.clientCode, pipelineId);
  }

  /**
   * Appends a new stage to an existing pipeline.
   *
   * **WORKING PROCESS:**
   * 1. Assigns an `order` value based on the current number of stages or `insertAfterOrder`.
   * 2. Persists the new `PipelineStage` document.
   * 3. Regenerates the board cache for the tenant.
   *
   * @param {string} pipelineId - Parent pipeline identifier.
   * @param {object} input - Stage configuration (name, color, probability).
   * @returns {Promise<IPipelineStage>}
   */
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

  /**
   * Updates stage-specific configuration and automation hooks.
   *
   * **WORKING PROCESS:**
   * 1. Updates fields like `color` or `probability`.
   * 2. If `autoActions` are changed, they will trigger for any lead moving into this stage from now on.
   *
   * @param {string} stageId - Target stage identifier.
   * @param {Partial<IPipelineStage>} updates - Fields to modify.
   * @returns {Promise<IPipelineStage | null>}
   */
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

  /**
   * Updates the visual sequence of stages on the Kanban board.
   *
   * @param {string} pipelineId - Parent pipeline identifier.
   * @param {UpdateStageOrderInput[]} newOrder - Array of { id, order }.
   * @returns {Promise<void>}
   */
  reorderStages(
    pipelineId: string,
    newOrder: UpdateStageOrderInput[],
  ): Promise<void> {
    return reorderStages(this.clientCode, pipelineId, newOrder);
  }

  /**
   * Removes a stage from the pipeline.
   *
   * **WORKING PROCESS:**
   * 1. Verifies if leads are present in the stage.
   * 2. If leads exist, they MUST be migrated to `moveLeadsToStageId` simultaneously.
   * 3. Deletes the `PipelineStage` document.
   *
   * @param {string} stageId - Target stage identifier.
   * @param {string} [moveLeadsToStageId] - Destination for orphaned leads.
   * @returns {Promise<void>}
   * @edge_case Fails if leads exist and no destination stage is provided.
   */
  deleteStage(stageId: string, moveLeadsToStageId?: string): Promise<void> {
    return deleteStage(this.clientCode, stageId, moveLeadsToStageId);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  /**
   * Aggregates lead counts and financial value per stage for the Kanban view.
   *
   * **WORKING PROCESS:**
   * 1. Queries the `Lead` collection grouped by `stageId`.
   * 2. Sums the `value` field for each stage.
   * 3. Merges the results with the `PipelineStage` definitions to ensure all columns (even empty ones) appear.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<BoardColumn[]>}
   */
  board(pipelineId: string): Promise<BoardColumn[]> {
    return getBoardSummary(this.clientCode, pipelineId);
  }

  /**
   * Calculates the weighted revenue forecast based on stage probabilities.
   *
   * **WORKING PROCESS:**
   * 1. Fetches current lead totals per stage.
   * 2. Multiplies total stage value by the stage's `probability` % (e.g., $1000 * 20% = $200).
   * 3. Returns a structured forecast for dynamic reporting.
   *
   * @param {string} pipelineId - Target pipeline identifier.
   * @returns {Promise<ForecastRow[]>}
   */
  forecast(pipelineId: string): Promise<ForecastRow[]> {
    return getRevenueForecast(this.clientCode, pipelineId);
  }
}
