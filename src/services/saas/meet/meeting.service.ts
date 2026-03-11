import mongoose from "mongoose";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { createGoogleMeetService } from "./google.meet.service.ts";

export interface CreateMeetingInput {
  leadId: string;
  appointmentId?: string;
  doctorId?: string;
  participantName: string;
  participantPhone: string;
  participantEmails?: string[];
  startTime: string | Date;
  endTime: string | Date;
  duration: number;
  meetingMode: "online" | "offline";
  type: "free" | "paid";
  amount?: number;
  metadata?: {
    refs?: Record<string, string | undefined>;
    extra?: Record<string, any>;
  };
}

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
      const googleMeetService = createGoogleMeetService();
      const response = await googleMeetService.createMeeting(clientCode, {
        summary: `Meeting: ${input.participantName}`,
        description: `Scheduled via ECODrIx. Type: ${input.type}`,
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

    const { runAutomations } = await import("../crm/automation.service.ts");
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findById(meeting.leadId);
    if (lead) {
      const meetCode = meeting.meetLink?.split("/").pop() || "";
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

      await runAutomations(clientCode, {
        trigger: "meeting_created" as any,
        lead: lead as any,
        variables,
        meetingId: (meeting as any)._id?.toString(),
      });

      // 4. Schedule future reminders (e.g. 1 hour before slot)
      const { scheduleMeetingReminders } =
        await import("../crm/automation.service.ts");
      await scheduleMeetingReminders(clientCode, meeting as any);
    }
  } catch (err) {
    console.error(
      `[meetingService] Hook execution failed for ${clientCode}:`,
      err,
    );
  }

  return meeting;
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
  }

  return meeting;
};
