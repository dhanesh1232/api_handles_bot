import { BaseRepository } from "@/lib/tenant/base.repository";
import { getCrmModels } from "@/lib/tenant/crm.models";

/**
 * PipelineRepository
 */
/**
 * Repository for managing Sales Pipelines.
 */
export class PipelineRepository extends BaseRepository<IPipeline> {
  /**
   * Retrieves active pipelines, sorted by their display order.
   */
  async findActive(query: any = {}) {
    return this.findMany({ ...query, isActive: true }, { sort: { order: 1 } });
  }

  /**
   * Resolves the primary pipeline for the tenant.
   *
   * **WORKING PROCESS:**
   * 1. Preference: Checks for the `isDefault: true` flag.
   * 2. Fallback: Returns the oldest active pipeline if no default is explicitly set.
   */
  async findDefault() {
    return (
      (await this.findOne({ isDefault: true, isActive: true })) ??
      (await this.findOne({ isActive: true }, { sort: { createdAt: 1 } }))
    );
  }
}

/**
 * Repository for managing individual stages within a pipeline.
 */
export class PipelineStageRepository extends BaseRepository<IPipelineStage> {
  /**
   * Fetches stages for a specific pipeline, ordered by `order`.
   */
  async findByPipeline(pipelineId: string) {
    return this.findMany({ pipelineId }, { sort: { order: 1 } });
  }

  /**
   * Resolves the starting (default) stage for a pipeline.
   *
   * **WORKING PROCESS:**
   * 1. Preference: Checks for `isDefault: true` at the stage level.
   * 2. Fallback: Uses the stage with the lowest `order` value (usually 0).
   */
  async findDefault(pipelineId: string) {
    return (
      (await this.findOne({ pipelineId, isDefault: true })) ??
      (await this.findOne({ pipelineId }, { sort: { order: 1 } }))
    );
  }
}

/**
 * Factories
 */
export async function getPipelineRepo(
  clientCode: string,
): Promise<PipelineRepository> {
  const { Pipeline } = await getCrmModels(clientCode);
  return new PipelineRepository(Pipeline, clientCode);
}

export async function getPipelineStageRepo(
  clientCode: string,
): Promise<PipelineStageRepository> {
  const { PipelineStage } = await getCrmModels(clientCode);
  return new PipelineStageRepository(PipelineStage, clientCode);
}
