import type { IJob } from "@models/queue/job.model";
import { executeStep } from "@services/saas/automation/sequenceEngine.service";
import { JobHandler } from "../base.handler";

export class SequenceStepJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    await executeStep(clientCode, payload.enrollmentId, payload.stepNumber);
  }
}
