import { getCrmModels } from "@lib/tenant/crm.models";
import { BaseRepository } from "@/lib/tenant/base.repository";

/**
 * Repository for managing lead Segments.
 */
export class SegmentRepository extends BaseRepository<ISegment> {
  // Add specialized methods if needed
}

/**
 * Factory function to initialize a SegmentRepository.
 */
export async function getSegmentRepo(
  clientCode: string,
): Promise<SegmentRepository> {
  const { Segment } = await getCrmModels(clientCode);
  return new SegmentRepository(Segment, clientCode);
}
