import type { IJob } from "@models/queue/job.model";
import { getSegmentService } from "@/services/saas/crm/segment.service";
import { JobHandler } from "../base.handler";

export class SegmentRefreshJobHandler extends JobHandler {
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
