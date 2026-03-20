/**
 * @file automation.sdk.ts
 * @module AutomationSDK
 * @responsibility Facade for triggering sequences and executing modular actions (WhatsApp, Email, etc.).
 * @dependencies ActionExecutor, SequenceEngine
 */

import { tenantLogger } from "@lib/logger";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";
import { enrollInSequence } from "@services/saas/automation/sequenceEngine.service";

export class AutomationSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Enrolls a lead into an automated sequence.
   *
   * @param {string} sequenceId - Target sequence identifier.
   * @param {any} lead - Lead document or identifier.
   * @param {any} [metadata={}] - Additional context for resolution.
   * @returns {Promise<void>}
   *
   * **DETAILED EXECUTION:**
   * 1. **Audit Logging**: Records the enrollment intent for transparency.
   * 2. **Sequence Engine Initialization**: Resolves the sequence definition and enrolls the lead.
   * 3. **Execution Injection**: Immediately triggers the first applicable step (if no delay is set).
   * 4. **State Machine**: Creates a `SequenceEnrollment` record to track progress through the drip.
   */
  async triggerSequence(sequenceId: string, lead: any, metadata: any = {}) {
    tenantLogger(this.clientCode).info(
      { sequenceId, leadId: lead._id },
      "Triggering sequence",
    );
    return enrollInSequence(this.clientCode, sequenceId, lead, metadata);
  }

  /**
   * Dispatches a specific action for immediate execution.
   *
   * **WORKING PROCESS:**
   * 1. Logs the direct execution request.
   * 2. Wraps the action into an `IAutomationAction` structure.
   * 3. Invokes `ActionExecutor.execute` (the dispatcher).
   *
   * @param {string} actionType - The type (e.g., 'send_whatsapp', 'send_email').
   * @param {any} actionData - Configuration for the specific action.
   * @param {any} [context={}] - Data for variable resolution (lead, vars).
   * @returns {Promise<any>} Execution result.
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
