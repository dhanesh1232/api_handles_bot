import type { IJob } from "@models/queue/job.model";
import { recalculateScore } from "@services/saas/crm/lead.service";
import { JobHandler } from "../base.handler";

export class ScoreRefreshJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    await recalculateScore(clientCode, payload.leadId);
  }
}
