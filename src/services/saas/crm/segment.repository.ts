import { getCrmModels } from "@/lib/tenant/get.crm.model";
import { BaseRepository } from "@/lib/tenant/base.repository";
import { ISegment } from "@/model/saas/crm/segment.model";

export class SegmentRepository extends BaseRepository<ISegment> {
  // Add specialized methods if needed
}

export async function getSegmentRepo(
  clientCode: string,
): Promise<SegmentRepository> {
  const { Segment } = await getCrmModels(clientCode);
  return new SegmentRepository(Segment, clientCode);
}
