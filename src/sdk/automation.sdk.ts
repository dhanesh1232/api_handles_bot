/**
 * sdk/automation.sdk.ts
 *
 * AutomationSDK — Facade for triggering sequences and executing actions.
 */

import { enrollInSequence } from "@services/saas/automation/sequenceEngine.service";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";
import { tenantLogger } from "@lib/logger";

export class AutomationSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Trigger/Enroll a lead in a sequence.
   */
  async triggerSequence(sequenceId: string, lead: any, metadata: any = {}) {
    tenantLogger(this.clientCode).info(
      { sequenceId, leadId: lead._id },
      "Triggering sequence",
    );
    return enrollInSequence(this.clientCode, sequenceId, lead, metadata);
  }

  /**
   * Execute a specific action immediately.
   */
  async executeAction(actionType: string, actionData: any, context: any = {}) {
    tenantLogger(this.clientCode).info(
      { actionType },
      "Executing direct action",
    );
    return ActionExecutor.execute(
      this.clientCode,
      { type: actionType, config: actionData },
      context,
    );
  }
}
