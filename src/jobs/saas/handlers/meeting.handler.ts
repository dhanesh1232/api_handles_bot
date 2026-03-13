import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { createGoogleMeetService } from "@services/saas/meet/google.meet.service";
import { onMeetingCreated } from "@services/saas/crm/crmHooks";

export class MeetingJobHandler extends JobHandler {
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    const svc = createGoogleMeetService();
    const result = await svc.createMeeting(clientCode, {
      summary: payload.title,
      description: payload.description,
      attendees: payload.attendees ?? [],
      start: payload.startTime,
      end: payload.endTime,
    });

    if (!result.success) {
      const errorMsg = result.error || "Unknown error";
      const { createNotification } =
        await import("@services/saas/crm/notification.service");
      await createNotification(clientCode, {
        title: "Meeting Creation Failed",
        message: `Failed to create Google Meet for ${payload.title}: ${errorMsg}`,
        type: "action_required",
        status: "unread",
        actionData: {
          error: errorMsg,
          actionConfig: { type: "google_meet", title: payload.title },
        },
      });
      throw new Error(`Google Meet creation failed: ${errorMsg}`);
    }

    await onMeetingCreated(clientCode, {
      phone: payload.phone,
      meetLink: result.hangoutLink ?? "",
      calendarEventId: result.eventId ?? "",
      title: payload.title,
      startTime: payload.startTime ? new Date(payload.startTime) : undefined,
      appointmentId: payload.appointmentId,
      performedBy: "system",
    });

    if (payload.callbackUrl) {
      const { sendCallbackWithRetry } = await import("@lib/callbackSender");
      void sendCallbackWithRetry({
        clientCode,
        callbackUrl: payload.callbackUrl,
        payload: {
          status: "created",
          meetLink: result.hangoutLink,
          eventId: result.eventId,
          createdAt: new Date(),
        },
        jobId: job._id?.toString(),
      });
    }
  }
}
