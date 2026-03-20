import { recalculateScore } from "@services/saas/crm/lead.service";
import { JobHandler } from "../base.handler";

export class ScoreRefreshJobHandler extends JobHandler {
  /**
   * Triggers an asynchronous lead score recalculation.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Contains the `leadId` to be refreshed.
   *
   * **DETAILED EXECUTION:**
   * 1. **Intelligence Refresh**: Directs to `lead.service.recalculateScore` which re-evaluates all heuristic rules (activity volume, email clicks, direct messages).
   * 2. **State Commit**: Updates the lead's `score.total` in the DB, triggering potential stage-move automations.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    await recalculateScore(clientCode, payload.leadId);
  }
}
