import { BaseRepository } from "../../../lib/tenant/base.repository";
import { getCrmModels } from "../../../lib/tenant/get.crm.model";

/**
 * PipelineRepository
 */
export class PipelineRepository extends BaseRepository<IPipeline> {
  async findActive(query: any = {}) {
    return this.findMany({ ...query, isActive: true }, { sort: { order: 1 } });
  }

  async findDefault() {
    return (
      (await this.findOne({ isDefault: true, isActive: true })) ??
      (await this.findOne({ isActive: true }, { sort: { createdAt: 1 } }))
    );
  }
}

/**
 * PipelineStageRepository
 */
export class PipelineStageRepository extends BaseRepository<IPipelineStage> {
  async findByPipeline(pipelineId: string) {
    return this.findMany({ pipelineId }, { sort: { order: 1 } });
  }

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
