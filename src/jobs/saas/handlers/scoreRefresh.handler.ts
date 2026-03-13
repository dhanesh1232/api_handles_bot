import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { recalculateScore } from "@services/saas/crm/lead.service";

export class ScoreRefreshJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    await recalculateScore(clientCode, payload.leadId);
  }
}
