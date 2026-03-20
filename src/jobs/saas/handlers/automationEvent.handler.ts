import { getCrmModels } from "@lib/tenant/crm.models";
import { EventBus } from "@services/saas/event/eventBus.service";
import { JobHandler } from "../base.handler";

export class AutomationEventJobHandler extends JobHandler {
  /**
   * Re-emits an automation event through the EventBus, typically for delayed or scheduled triggers.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Data containing `trigger`, `leadId`, and `variables`.
   *
   * **DETAILED EXECUTION:**
   * 1. **State Recovery**: Fetches the lead to ensure data freshness (latest phone/email).
   * 2. **Payload Normalization**: Guarantees that `stageId` and `score` are passed as strings to the `EventBus`.
   * 3. **Bus Dispatch**: Invokes `EventBus.emit` to restart the rule-evaluation engine for this event.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Missing Lead: Throws a hard error if the lead has been purged; this will stop the job from infinite retries if configured.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
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
