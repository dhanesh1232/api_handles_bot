import { executeStep } from "@services/saas/automation/sequenceEngine.service";
import { JobHandler } from "../base.handler";

export class SequenceStepJobHandler extends JobHandler {
  /**
   * Executes a specific step within a lead's sequence enrollment (drip campaign).
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Contains `enrollmentId` and the specific `stepNumber` to trigger.
   *
   * **DETAILED EXECUTION:**
   * 1. **Step Trigger**: Delegates to `sequenceEngine.service.executeStep`.
   * 2. **Context Resolution**: The engine fetches the enrollment state, resolves the action for the current step, and dispatches it (e.g., WhatsApp, Wait, or Branch).
   * 3. **State Progression**: Updates the enrollment to the next step or marks it as finished.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    await executeStep(clientCode, payload.enrollmentId, payload.stepNumber);
  }
}
