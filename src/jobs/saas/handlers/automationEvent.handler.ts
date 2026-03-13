import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { getCrmModels } from "@lib/tenant/get.crm.model";
import { EventBus } from "@services/saas/event/eventBus.service";

export class AutomationEventJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    const { trigger, leadId, variables, stageId, tagName, score } = payload;
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findById(leadId).lean();

    if (!lead) {
      throw new Error(`Automation event lead ${leadId} not found`);
    }

    await EventBus.emit(clientCode, trigger, {
      phone: (lead as any).phone,
      email: (lead as any).email,
      data: lead,
      variables: {
        ...variables,
        stageId: stageId ? String(stageId) : undefined,
        tagName: tagName || undefined,
        score: score ? String(score) : undefined,
      },
    });
  }
}
