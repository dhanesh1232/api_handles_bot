import type { ErixJobs } from "@lib/erixJobs/index";
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
   * Enqueue a CRM job for the current tenant.
   */
  async enqueue(
    type: CrmJobType,
    payload: Record<string, any>,
    opts?: JobOptions,
  ) {
    // Note: crmQueue is an instance of ErixJobs
    return crmQueue.add(
      {
        clientCode: this.clientCode,
        type,
        payload,
      },
      opts,
    );
  }

  /**
   * Utility for commonly used jobs
   */
  async sendEmail(to: string, subject: string, html: string, text?: string) {
    return this.enqueue("crm.email", { to, subject, html, text });
  }

  async refreshLeadScore(leadId: string) {
    return this.enqueue("crm.score_refresh", { leadId });
  }
}
