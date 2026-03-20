/**
 * @file job.sdk.ts
 * @module JobSDK
 * @responsibility Tenant-isolated job enqueuing facade for the ErixJobs system.
 * @dependencies crmWorker, ErixJobs
 */

import { crmQueue } from "@jobs/saas/crmWorker";

export type CrmJobType =
  | "crm.automation_action"
  | "crm.automation_event"
  | "crm.email"
  | "crm.meeting"
  | "crm.reminder"
  | "crm.score_refresh"
  | "crm.webhook_notify"
  | "crm.whatsapp_broadcast"
  | "crm.sequence_step";

export interface JobOptions {
  delay?: number;
  priority?: number;
}

export class JobSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Enqueues a standardized CRM job for the current tenant.
   *
   * **WORKING PROCESS:**
   * 1. Wraps the `type` and `payload` into a queue job object.
   * 2. Automatically binds the job to `this.clientCode` for tenant isolation.
   * 3. Dispatches to the `crmQueue` (ErixJobs instance).
   * 4. Jobs are stored in the database and picked up by background workers based on `priority` and `delayMs`.
   *
   * @param {CrmJobType} type - The job identifier (e.g., 'crm.email').
   * @param {Record<string, any>} payload - Job data.
   * @param {JobOptions} [opts] - Scheduling options (delay, priority).
   * @returns {Promise<any>} The created job record.
   */
  async enqueue(
    type: CrmJobType,
    payload: Record<string, any>,
    opts?: JobOptions,
  ) {
    // Note: crmQueue is an instance of ErixJobs
    return crmQueue.add(
      this.clientCode,
      {
        type,
        payload,
      },
      {
        delayMs: opts?.delay,
        priority: opts?.priority,
      },
    );
  }

  /**
   * Helper to enqueue a background email job.
   *
   * @param {string} to - Recipient.
   * @param {string} subject - Subject line.
   * @param {string} html - HTML body.
   * @param {string} [text] - Optional plain-text fallback.
   * @returns {Promise<any>}
   */
  async sendEmail(to: string, subject: string, html: string, text?: string) {
    return this.enqueue("crm.email", { to, subject, html, text });
  }

  /**
   * Helper to trigger a lead score recalculation.
   *
   * **WORKING PROCESS:**
   * 1. Enqueues a `crm.score_refresh` job.
   * 2. The worker will independently fetch the lead's history and apply scoring logic.
   *
   * @param {string} leadId - Lead identifier.
   * @returns {Promise<any>}
   */
  async refreshLeadScore(leadId: string) {
    return this.enqueue("crm.score_refresh", { leadId });
  }
}
