import { dbConnect } from "@lib/config";
import { getClientConfig, getCrmModels } from "@lib/tenant/crm.models";
import Job from "@models/queue/job.model";
import mongoose from "mongoose";
import { createGoogleMeetService } from "./google.meet.service.ts";

/**
 * Backend service for managing meetings and consultations.
 * Added test comment.
 */

export const createMeeting = async (
  clientCode: string,
  input: CreateMeetingInput,
): Promise<IMeeting> => {
  const { Meeting, LeadActivity } = await getCrmModels(clientCode);

  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);

  const emails = input.participantEmails || [];

  // 1. Create Google Meet link (only for online meetings)
  let meetResponse: {
    success: boolean;
    hangoutLink: string | null;
    eventId: string | null;
  } = { success: false, hangoutLink: null, eventId: null };

  if (input.meetingMode === "online") {
    try {
      const clientConfig = await getClientConfig(clientCode);
      const googleMeetService = createGoogleMeetService();
      const response = await googleMeetService.createMeeting(clientCode, {
        summary: `Meeting: ${input.participantName}`,
        description: `Scheduled via ${clientConfig?.name}. Type: ${input.type}`,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        attendees: emails,
      });
      meetResponse = {
        success: response.success,
        hangoutLink: (response.hangoutLink as any) || null,
        eventId: (response.eventId as any) || null,
      };
    } catch (err: any) {
      console.error("Google Meet creation failed:", err.message);
    }
  }

  // 2. Create Meeting record
  const meeting = await Meeting.create({
    clientCode,
    leadId: new mongoose.Types.ObjectId(input.leadId),
    participantName: input.participantName,
    participantPhone: input.participantPhone,
    participantEmails: emails,
    startTime,
    endTime,
    duration: input.duration,
    meetingMode: input.meetingMode,
    meetLink: meetResponse.hangoutLink,
    meetCode: meetResponse.hangoutLink?.split("/").pop() || null,
    eventId: meetResponse.eventId,
    type: input.type,
    amount: input.amount,
    paymentStatus: input.type === "free" ? "na" : "pending",
    status: "scheduled",
    metadata: {
      refs: {
        appointmentId: input.appointmentId
          ? new mongoose.Types.ObjectId(input.appointmentId)
          : null,
        doctorId: input.doctorId || null,
        ...((input.metadata as any)?.refs || {}),
      },
      extra: (input.metadata as any)?.extra || {},
    },
  });

  // 3. Log activity and trigger hooks
  try {
    const { onMeetingCreated } = await import("../crm/crmHooks.ts");
    await onMeetingCreated(clientCode, {
      phone: input.participantPhone,
      meetLink: meeting.meetLink || "",
      meetCode: meeting.meetCode || "",
      meetingId: (meeting as any)._id?.toString(),
      calendarEventId: meeting.eventId || "",
      title: `Meeting: ${input.participantName}`,
      startTime: meeting.startTime,
      appointmentId: input.appointmentId,
      performedBy: "system",
    });

    // Trigger event via EventBus — handles both runAutomations and scheduleMeetingReminders
    const { EventBus } = await import("../event/eventBus.service.ts");
    const meetCode = meeting.meetLink?.split("/").pop() || "";

    // Build standard variables context
    const variables = {
      meet_link: meeting.meetLink || "",
      meet_code: meetCode,
      start_time: meeting.startTime.toISOString(),
      date: meeting.startTime.toLocaleDateString("en-IN"),
      time: meeting.startTime.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      participant_name: meeting.participantName,
      meeting_mode: meeting.meetingMode,
      amount: meeting.amount?.toString() || "0",
      meeting_id: (meeting as any)._id?.toString(),
      ...(meeting.metadata as any)?.extra,
    };

    void EventBus.emit(clientCode, "meeting.created", {
      phone: meeting.participantPhone,
      data: meeting,
      variables,
    });
  } catch (err) {
    console.error(
      `[meetingService] Hook execution failed for ${clientCode}:`,
      err,
    );
  }

  return meeting.toObject() as unknown as IMeeting;
};

/**
 * Cancel all pending reminder jobs for a meeting.
 */
export const cancelMeetingReminders = async (
  clientCode: string,
  meetingId: string,
): Promise<void> => {
  // 1. Mark in-document reminders as cancelled OR just tag as rescheduled
  const { Meeting } = await getCrmModels(clientCode);

  // Mark all existing reminders as 'rescheduled' so they are labeled in UI
  await Meeting.updateOne(
    { _id: meetingId, clientCode },
    {
      $set: {
        "reminders.$[].rescheduled": true,
        rescheduledAt: new Date(),
      },
    },
  );

  // Also mark 'pending' ones specifically as 'cancelled'
  await Meeting.updateOne(
    { _id: meetingId, clientCode },
    { $set: { "reminders.$[r].status": "cancelled" } },
    { arrayFilters: [{ "r.status": "pending" }] },
  );

  // 2. Delete pending background jobs
  await dbConnect("services");
  const result = await Job.deleteMany({
    queue: "crm",
    status: "waiting",
    "data.payload.meetingId": meetingId,
  });
  console.log(
    `[meetingService] Cancelled ${result.deletedCount} pending reminders for meeting ${meetingId}`,
  );
};

export const getMeetingById = async (
  clientCode: string,
  meetingId: string,
): Promise<IMeeting | null> => {
  const { Meeting } = await getCrmModels(clientCode);
  return Meeting.findOne({
    _id: meetingId,
    clientCode,
  }).lean() as unknown as Promise<IMeeting | null>;
};

export const listMeetings = async (
  clientCode: string,
  filters: { leadId?: string; status?: string; appointmentId?: string } = {},
): Promise<IMeeting[]> => {
  const { Meeting } = await getCrmModels(clientCode);
  const query: any = { clientCode };
  if (filters.leadId)
    query.leadId = new mongoose.Types.ObjectId(filters.leadId);
  if (filters.status) query.status = filters.status;
  if (filters.appointmentId)
    query["metadata.refs.appointmentId"] = new mongoose.Types.ObjectId(
      filters.appointmentId,
    );

  return Meeting.find(query)
    .sort({ startTime: -1 })
    .lean() as unknown as Promise<IMeeting[]>;
};

export const updateMeetingStatus = async (
  clientCode: string,
  meetingId: string,
  status: IMeeting["status"],
  paymentStatus?: IMeeting["paymentStatus"],
): Promise<IMeeting | null> => {
  const { Meeting, LeadActivity } = await getCrmModels(clientCode);
  const update: any = { status };
  if (paymentStatus) update.paymentStatus = paymentStatus;

  const meeting = (await Meeting.findOneAndUpdate(
    { _id: meetingId, clientCode },
    { $set: update },
    { returnDocument: "after" },
  ).lean()) as unknown as IMeeting | null;

  if (meeting) {
    await LeadActivity.create({
      clientCode,
      leadId: meeting.leadId,
      type: status === "completed" ? "meeting_completed" : "system",
      title: `Meeting ${status}`,
      metadata: { meetingId, status, paymentStatus },
      performedBy: "system",
    });

    // Special handling for cancellation: remove reminders and calendar events
    if (status === "cancelled") {
      try {
        await cancelMeetingReminders(clientCode, meetingId);

        if (meeting.eventId) {
          const googleMeetService = createGoogleMeetService();
          await googleMeetService.deleteMeeting(clientCode, meeting.eventId);
        }
      } catch (err: any) {
        console.error(
          `[meetingService] Cleanup failed for cancelled meeting ${meetingId}:`,
          err.message,
        );
      }
    }
  }

  return meeting;
};

/**
 * Reschedule an existing meeting.
 */
export const rescheduleMeeting = async (
  clientCode: string,
  meetingId: string,
  input: { startTime: Date; endTime: Date; duration: number },
): Promise<IMeeting | null> => {
  const { Meeting, LeadActivity } = await getCrmModels(clientCode);

  const meeting = await Meeting.findOne({ _id: meetingId, clientCode });
  if (!meeting) return null;

  // 1. Update Google Calendar event if exists
  if (meeting.meetingMode === "online" && meeting.eventId) {
    try {
      const googleMeetService = createGoogleMeetService();
      await googleMeetService.updateMeeting(clientCode, meeting.eventId, {
        summary: `Meeting: ${meeting.participantName}`,
        start: input.startTime.toISOString(),
        end: input.endTime.toISOString(),
      });
    } catch (err: any) {
      console.error(
        `Google Meet update failed for meeting ${meetingId}:`,
        err.message,
      );
    }
  }

  // 2. Update Meeting record
  const updatedMeeting = (await Meeting.findOneAndUpdate(
    { _id: meetingId, clientCode },
    {
      $set: {
        startTime: input.startTime,
        endTime: input.endTime,
        duration: input.duration,
        status: "scheduled",
      },
    },
    { returnDocument: "after" },
  ).lean()) as unknown as IMeeting | null;

  if (updatedMeeting) {
    // 3. Log activity
    await LeadActivity.create({
      clientCode,
      leadId: updatedMeeting.leadId,
      type: "system",
      title: "Meeting Rescheduled",
      metadata: {
        meetingId,
        startTime: input.startTime,
        endTime: input.endTime,
      },
      performedBy: "system",
    });

    // 4. Reschedule reminders (cancel old, emit new event)
    try {
      await cancelMeetingReminders(clientCode, meetingId);

      const { EventBus } = await import("../event/eventBus.service.ts");
      const meetCode = updatedMeeting.meetLink?.split("/").pop() || "";

      const variables = {
        meet_link: updatedMeeting.meetLink || "",
        meet_code: meetCode,
        start_time: updatedMeeting.startTime.toISOString(),
        date: updatedMeeting.startTime.toLocaleDateString("en-IN"),
        time: updatedMeeting.startTime.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        participant_name: updatedMeeting.participantName,
        meeting_mode: updatedMeeting.meetingMode,
        amount: updatedMeeting.amount?.toString() || "0",
        meeting_id: (updatedMeeting as any)._id?.toString(),
      };

      // Emit "meeting.rescheduled" or reuse "meeting.created" if rules are common
      void EventBus.emit(clientCode, "meeting.rescheduled", {
        phone: updatedMeeting.participantPhone,
        data: updatedMeeting,
        variables,
      });
    } catch (err) {
      console.error(
        `[meetingService] Hook execution failed for reschedule ${clientCode}:`,
        err,
      );
    }
  }

  return updatedMeeting;
};
