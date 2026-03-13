import { BaseRepository } from "../../../lib/tenant/base.repository";
import type { Model } from "mongoose";

/**
 * LeadRepository
 *
 * Tenant-scoped repository for Lead operations.
 */
export class LeadRepository extends BaseRepository<ILead> {
  constructor(model: Model<ILead>, clientCode: string) {
    super(model, clientCode);
  }

  /**
   * Custom query to find a lead by normalized phone.
   */
  async findByPhone(phone: string) {
    return this.findOne({ phone });
  }

  /**
   * Find leads in a specific stage.
   */
  async findByStage(pipelineId: string, stageId: string) {
    return this.findMany({ pipelineId, stageId });
  }
}
