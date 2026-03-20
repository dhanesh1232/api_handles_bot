import { onMeetingCreated } from "@services/saas/crm/crmHooks";
import { createGoogleMeetService } from "@services/saas/meet/google.meet.service";
import { JobHandler } from "../base.handler";

export class MeetingJobHandler extends JobHandler {
  /**
   * Orchestrates the creation of virtual meeting spaces (Google Meet) for scheduled appointments.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Meeting details including `title`, `attendees`, and `startTime`.
   * @param job - Job instance for observability.
   *
   * **DETAILED EXECUTION:**
   * 1. **Provider Authentication**: Initializes the `GoogleMeetService` using the tenant's stored OAuth credentials.
   * 2. **Calendar Injection**: Requests a new event on the tenant's primary calendar with `conferenceData` enabled.
   * 3. **State Synthesis**: If successful, triggers `onMeetingCreated` to sync the logic back to the CRM (updates lead timeline, schedules reminders).
   * 4. **Success Callback**: Notifies external systems via `callbackUrl` with the newly generated `meetLink`.
   *
   * **EDGE CASE MANAGEMENT:**
   * - API Failure: If Google rejects the creation (e.g., expired token), creates an 'action_required' notification for the user and throws to trigger a queue retry.
   */
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
      const { createNotification } = await import(
        "@services/saas/crm/notification.service"
      );
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
