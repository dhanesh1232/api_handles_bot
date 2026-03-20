import { getCrmModels } from "@lib/tenant/crm.models";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";
import { logActivity } from "@services/saas/crm/activity.service";
import { createNotification } from "@services/saas/crm/notification.service";
import { JobHandler } from "../base.handler";

export class AutomationActionJobHandler extends JobHandler {
  /**
   * Dispatches and evaluates a single automation action (WhatsApp, Email, etc.) for a specific lead.
   *
   * @param clientCode - Tenant identifier for multi-tenant isolation.
   * @param payload - Execution context including `actionType`, `actionConfig`, and `leadId`.
   * @param _job - The raw Bull/Job queue object for retry tracking.
   *
   * **DETAILED EXECUTION:**
   * 1. **Lead Validation**: Fetches the lead; aborts if the lead was deleted between scheduling and execution.
   * 2. **Action Dispatch**: Delegates to `ActionExecutor.execute` which routes to the specific provider (Meta, SES, etc.).
   * 3. **Meeting Sync**: If this is a meeting reminder, updates the specific reminder status to 'sent' within the `Meeting` document.
   * 4. **Interaction Logging**: Calls `logSuccessActivity` to ensure the lead's timeline reflects the automation.
   * 5. **Notification Cleanup**: Resolves any "failed" notifications for this specific action type if it finally succeeds.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Execution Failure: Catches provider errors, logs them to the lead timeline, and creates an 'action_required' notification for the tenant admin.
   * - Retries: Rethrows the error to trigger the queue's exponential backoff status.
   */
  async handle(clientCode: string, payload: any, _job: IJob): Promise<void> {
    const { actionType, actionConfig, leadId, ctxVariables } = payload;
    const { Lead, Meeting, Notification } = await getCrmModels(clientCode);

    const lead = await Lead.findById(leadId).lean();
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    try {
      await ActionExecutor.execute(
        clientCode,
        { type: actionType, config: actionConfig },
        {
          lead: lead as any,
          variables: ctxVariables,
          meetingId: payload.meetingId,
        },
        (global as any).io,
      );

      // Handle meeting status updates
      if (payload.meetingId && payload.actionId) {
        await Meeting.updateOne(
          { _id: payload.meetingId, "reminders.actionId": payload.actionId },
          {
            $set: {
              "reminders.$.status": "sent",
              "reminders.$.sentAt": new Date(),
            },
          },
        );
      }

      // Activity Logging
      await this.logSuccessActivity(
        clientCode,
        lead._id.toString(),
        actionType,
        actionConfig,
        payload,
      );

      // Auto-resolve existing failure notifications
      const resolveFilter: any = {
        clientCode,
        status: "unread",
        "actionData.leadId": lead._id,
      };
      if (payload.meetingId)
        resolveFilter["actionData.meetingId"] = payload.meetingId;
      else if (actionConfig?.templateName)
        resolveFilter["actionData.actionConfig.templateName"] =
          actionConfig.templateName;

      await Notification.updateMany(resolveFilter, {
        $set: { status: "resolved" },
      });
    } catch (err: any) {
      this.log.error(
        { actionType, err: err.message },
        "Action execution failed",
      );

      if (payload.meetingId && payload.actionId) {
        await Meeting.updateOne(
          { _id: payload.meetingId, "reminders.actionId": payload.actionId },
          {
            $set: {
              "reminders.$.status": "failed",
              "reminders.$.error": err.message,
            },
          },
        );
      }

      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "system",
        title: `Action Failed: ${actionType}`,
        body: `Error: ${err.message}`,
        metadata: {
          meetingId: payload.meetingId,
          actionType,
          error: err.message,
        },
        performedBy: "system",
      });

      // Create failure notification
      const isMeetError =
        err.message.includes("Google Meet") || err.message.includes("meet_");
      await createNotification(clientCode, {
        title: isMeetError ? "Meeting Link Error" : "Automation Action Failed",
        message: `Failed to execute ${actionType} for lead ${lead.firstName}: ${err.message}`,
        type: "action_required",
        status: "unread",
        actionData: {
          leadId: lead._id,
          meetingId: payload.meetingId,
          error: err.message,
          actionConfig,
          actionType,
          contextSnapshot: ctxVariables,
        },
      });

      throw err; // Rethrow to mark job as failed in queue
    }
  }

  /**
   * Internal helper to categorize and log the successful completion of an automation action to the lead's timeline.
   *
   * **DETAILED EXECUTION:**
   * 1. **Handshake**: Directs to `whatsapp_sent` or `email_sent` activity types based on the `type` parameter.
   * 2. **Context Enrichment**: Attaches `meetingId` and `templateName` to metadata for historical traceability in the UI.
   */
  private async logSuccessActivity(
    clientCode: string,
    leadId: string,
    type: string,
    config: any,
    payload: any,
  ) {
    if (type === "send_whatsapp") {
      await logActivity(clientCode, {
        leadId,
        type: "whatsapp_sent",
        title: `Automation: ${config.templateName}`,
        body: payload.meetingId
          ? `Reminder sent for meeting`
          : `Sent via automation rule`,
        metadata: {
          meetingId: payload.meetingId,
          templateName: config.templateName,
        },
        performedBy: "system",
      });
    } else if (type === "send_email") {
      await logActivity(clientCode, {
        leadId,
        type: "email_sent",
        title: `Email: ${config.subject || "Automation"}`,
        body: payload.meetingId
          ? `Reminder sent for meeting`
          : `Sent via automation rule`,
        metadata: { meetingId: payload.meetingId },
        performedBy: "system",
      });
    } else {
      await logActivity(clientCode, {
        leadId,
        type: "automation_triggered",
        title: `Executed: ${type}`,
        performedBy: "system",
      });
    }
  }
}
