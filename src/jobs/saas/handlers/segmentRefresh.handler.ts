import { getSegmentService } from "@/services/saas/crm/segment.service";
import { JobHandler } from "../base.handler";

export class SegmentRefreshJobHandler extends JobHandler {
  /**
   * Re-evaluates dynamic lead segments based on updated criteria.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Optional `segmentId`. If omitted, refreshes ALL segments for the tenant.
   *
   * **DETAILED EXECUTION:**
   * 1. **Scope Resolution**: Detects if we are targeting a single segment or a global refresh.
   * 2. **Rule Matching**: Executes the `refreshSegment` logic which re-runs the segment's query filter against the current lead database.
   * 3. **Membership Sync**: Atomically updates the `Segment` count and its associated lead membership lists.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    const { segmentId } = payload;
    const segmentService = await getSegmentService(clientCode);

    if (segmentId) {
      this.log.info(
        { segmentId, clientCode },
        "[SegmentRefresh] Refreshing single segment",
      );
      await segmentService.refreshSegment(segmentId);
    } else {
      this.log.info(
        { clientCode },
        "[SegmentRefresh] Refreshing all segments for client",
      );
      const segments = await segmentService.listSegments();
      for (const segment of segments) {
        // We could enqueue these as individual jobs if there are too many segments,
        // but for now, we process them sequentially in one job.
        await segmentService.refreshSegment((segment as any)._id.toString());
      }
    }
  }
}
