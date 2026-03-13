import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";
import { getCrmModels } from "@lib/tenant/get.crm.model";
import { logActivity } from "@services/saas/crm/activity.service";
import { createNotification } from "@services/saas/crm/notification.service";

export class AutomationActionJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    const { actionType, actionConfig, leadId, ctxVariables } = payload;
    const { Lead, Meeting, Notification } = await getCrmModels(clientCode);

    const lead = await Lead.findById(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    try {
      await ActionExecutor.execute(
        clientCode,
        { type: actionType, config: actionConfig },
        {
          lead: lead.toJSON(),
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
