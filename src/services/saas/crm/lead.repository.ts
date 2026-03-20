import { BaseRepository } from "@/lib/tenant/base.repository";

/**
 * LeadRepository
 *
 * Tenant-scoped repository for Lead operations.
 */
/**
 * Tenant-scoped repository for high-level Lead data access.
 *
 * **RESPONSIBILITY:**
 * Provides optimized access methods for lead retrieval by phone, identity, and pipeline position.
 * Extends `BaseRepository` to inherit standardized multi-tenant CRUD.
 */
export class LeadRepository extends BaseRepository<ILead> {
  /**
   * Retrieves a single lead by their phone number.
   *
   * **WORKING PROCESS:**
   * 1. Query: Runs a direct `findOne` on the tenant-scoped collection.
   *
   * **EDGE CASES:**
   * - Format Mismatch: Expects normalized phone numbers (E.164) as stored in the DB.
   */
  async findByPhone(phone: string) {
    return this.findOne({ phone });
  }

  /**
   * Batch retrieves leads belonging to a specific pipeline and stage.
   *
   * **WORKING PROCESS:**
   * 1. Filter: Targets `pipelineId` and `stageId` simultaneously.
   */
  async findByStage(pipelineId: string, stageId: string) {
    return this.findMany({ pipelineId, stageId });
  }
}
