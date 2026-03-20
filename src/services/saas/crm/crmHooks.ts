/**
 * @module Services/CRM/Hooks
 * @responsibility Acts as the "Sensory Nervous System" of the CRM, listening to external events (WhatsApp, Meet, Email) and syncing them into the Unified Lead Timeline.
 *
 * **GOAL:** Provide a zero-friction integration layer where external services can "report in" to the CRM without knowing about its internal complexity or schema details.
 */

import { sendCallbackWithRetry } from "@/lib/callbackSender";
import { getCrmModels } from "@/lib/tenant/crm.models";
import { ClientSecrets } from "@/model/clients/secrets";
import { EventBus } from "../event/eventBus.service.ts";
import { logActivity } from "./activity.service.ts";
import { recalculateScore } from "./lead.service.ts";

// ─── WhatsApp outbound ────────────────────────────────────────────────────────

/**
 * Syncs outbound WhatsApp messages into the CRM lead timeline.
 *
 * @param clientCode - The unique identifier of the tenant/business (e.g., "EDX"). Used to scope the DB connection.
 * @param input - Detailed payload from the WhatsApp service.
 * @param input.phone - Recipient's E.164 phone number. Used to locate the lead record.
 * @param input.messageId - The unique ID returned by Meta/WhatsApp API. Crucial for reply tracking.
 * @param input.templateName - (Optional) Name of the Meta-approved template used.
 * @param input.content - (Optional) The raw text content sent to the user.
 * @param input.performedBy - (Optional) The actor triggering the send (e.g., "automation", "user_id"). Defaults to "system".
 *
 * @returns {Promise<void>} Executes asynchronously. Fail-safe design: will not throw errors even if CRM logic fails, ensuring core WhatsApp delivery isn't blocked.
 *
 * **DETAILED EXECUTION:**
 * 1. **Tenant Resolution**: Dynamically connects to the tenant's specific CRM database using `getCrmModels`.
 * 2. **Lead Discovery**: Performs a `.findOne` query using `phone` + `clientCode`. Uses `.lean()` for high-speed read.
 * 3. **Exit Condition**: If no lead exists for this phone number, it aborts (prevents logging for non-CRM contacts).
 * 4. **Timeline Injection**: Calls `logActivity` to create a `whatsapp_sent` record.
 * 5. **Metadata Mapping**: Richly maps `messageId` and `templateName` into the activity metadata for future reply-matching.
 */
export const onWhatsAppSent = async (
  clientCode: string,
  input: {
    phone: string;
    messageId: string;
    templateName?: string;
    content?: string;
    performedBy?: string;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findOne({ clientCode, phone: input.phone }).lean();
    if (!lead) return;
    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "whatsapp_sent",
      title: input.templateName
        ? `WhatsApp template sent: ${input.templateName}`
        : "WhatsApp message sent",
      body: input.content ?? "",
      metadata: {
        messageId: input.messageId,
        templateName: input.templateName ?? null,
        phone: input.phone,
      },
      performedBy: input.performedBy ?? "system",
    });
  } catch {
    /* Never let CRM errors break WhatsApp sending */
  }
};

// ─── WhatsApp inbound ─────────────────────────────────────────────────────────

/**
 * Orchestrates the "First Touch" or "Nurture" logic when a WhatsApp message is received.
 *
 * @param clientCode - Unique tenant identifier used for data isolation.
 * @param input - Payload from the inbound WhatsApp webhook.
 * @param input.phone - Sender's phone number.
 * @param input.messageId - Unique Meta ID for the inbound message.
 * @param input.content - The text message body.
 * @param input.messageType - The type of message (text, image, button_reply, etc.).
 *
 * @returns {Promise<void>} Handles lead upsert, activity logging, and scoring in parallel.
 *
 * **DETAILED EXECUTION:**
 * 1. **Lead Lookup**: Searches for an existing lead by phone number.
 * 2. **Auto-Discovery (Upsert)**: If no lead exists, it dynamically imports `lead.service` and creates a new lead, tagging the source as "whatsapp".
 * 3. **Timeline Logging**: Records the message as a `whatsapp_received` activity.
 * 4. **State Update**: Updates the lead's `lastContactedAt` timestamp to "now" to keep the pipeline fresh.
 * 5. **Intelligence Trigger**: Triggers `recalculateScore` which might move the lead to a "Hot" category based on this engagement.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Unknown Media: If the message is an image/video without text, `content` might be a URL; the CRM preserves this as raw data.
 */
export const onWhatsAppReceived = async (
  clientCode: string,
  input: {
    phone: string;
    messageId: string;
    content: string;
    messageType: string;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    let lead = await Lead.findOne({ clientCode, phone: input.phone }).lean();

    if (!lead) {
      const { createLead } = await import("./lead.service.ts");
      lead = (await createLead(clientCode, {
        firstName: input.phone,
        phone: input.phone,
        source: "whatsapp",
      })) as any;
    }
    if (!lead) return;

    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "whatsapp_received",
      title: `WhatsApp received (${input.messageType})`,
      body: input.content,
      metadata: {
        messageId: input.messageId,
        messageType: input.messageType,
        phone: input.phone,
      },
      performedBy: "contact",
    });

    await Lead.updateOne(
      { _id: lead._id },
      { $set: { lastContactedAt: new Date() } },
    );
    await recalculateScore(clientCode, lead._id.toString());
  } catch {
    /* Never let CRM errors break webhook processing */
  }
};

// ─── WhatsApp delivery status ─────────────────────────────────────────────────

/**
 * Processes Meta's delivery reports to update lead engagement metrics.
 *
 * @param clientCode - Tenant ID.
 * @param input - Delivery status payload.
 * @param input.phone - Recipient phone.
 * @param input.messageId - ID of the message being tracked.
 * @param input.status - Current state: `sent`, `delivered`, `read`, or `failed`.
 *
 * @returns {Promise<void>}
 *
 * **DETAILED EXECUTION:**
 * 1. **Status Filtering**: Specifically watches for "read" and "delivered" events only.
 * 2. **Intent Logic**:
 *    - "read" = High Intent. Injects `whatsapp_read` activity and boosts the lead score.
 *    - "delivered" = Reachable. Injects `whatsapp_delivered` activity.
 * 3. **Persistence**: Updates the lead timeline with the timestamp of the delivery event.
 */
export const onWhatsAppStatus = async (
  clientCode: string,
  input: {
    phone: string;
    messageId: string;
    status: "sent" | "delivered" | "read" | "failed";
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findOne({ clientCode, phone: input.phone }).lean();
    if (!lead) return;

    if (input.status === "read") {
      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "whatsapp_read",
        title: "WhatsApp message read",
        metadata: { messageId: input.messageId },
        performedBy: "system",
      });
      await recalculateScore(clientCode, lead._id.toString());
    } else if (input.status === "delivered") {
      await logActivity(clientCode, {
        leadId: lead._id.toString(),
        type: "whatsapp_delivered",
        title: "WhatsApp message delivered",
        metadata: { messageId: input.messageId },
        performedBy: "system",
      });
    }
  } catch {
    /* non-critical */
  }
};

// ─── Google Meet created ──────────────────────────────────────────────────────

/**
 * Primary integration point for scheduling events (Google Meet).
 *
 * @param clientCode - Tenant ID.
 * @param input - Detailed meeting payload.
 * @param input.phone - Participant's phone.
 * @param input.meetLink - URL for the meeting.
 * @param input.meetCode - (Optional) Human-readable meeting code.
 * @param input.meetingId - (Optional) Internal meeting UUID.
 * @param input.calendarEventId - Google Calendar internal ID.
 * @param input.title - Subject of the meeting.
 * @param input.startTime - When the meeting starts.
 * @param input.appointmentId - (Optional) ID from the booking system (e.g., Setmore).
 * @param input.performedBy - Actor name.
 * @param input.participantName - Lead's name.
 * @param input.meetingMode - Video vs Audio.
 * @param input.amount - (Optional) If the meeting was paid for.
 *
 * @returns {Promise<void>} Orchestrates timeline logging, metadata linking, scoring, and external webhook callbacks.
 *
 * **DETAILED EXECUTION:**
 * 1. **Context Loading**: Retrieves the Lead record using `phone`.
 * 2. **Timeline Entry**: Logs `meeting_created` activity with all relevant links and timestamps.
 * 3. **Reference Linking**: If `appointmentId` is present, it updates the lead's metadata to store this reference, enabling cross-system tracking.
 * 4. **Priority Boost**: Recalculates lead score (high weighting for meetings).
 * 5. **Outbound Notification (Webhook)**:
 *    - Fetches `MEETING_CALLBACK_URL` from encrypted `ClientSecrets`.
 *    - If configured, sends a POST request with the combined payload to the client's external server via `sendCallbackWithRetry`.
 */
export const onMeetingCreated = async (
  clientCode: string,
  input: {
    phone: string;
    meetLink: string;
    meetCode?: string;
    meetingId?: string;
    calendarEventId: string;
    title?: string;
    startTime?: Date;
    appointmentId?: string;
    performedBy?: string;
    participantName?: string;
    meetingMode?: string;
    amount?: number;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findOne({ clientCode, phone: input.phone }).lean();
    if (!lead) return;

    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "meeting_created",
      title: `Meeting: ${input.title ?? "Meeting scheduled"}`,
      body: input.meetLink,
      metadata: {
        meetLink: input.meetLink,
        calendarEventId: input.calendarEventId,
        startTime: input.startTime?.toISOString() ?? null,
        appointmentId: input.appointmentId ?? null,
      },
      performedBy: input.performedBy ?? "system",
    });

    if (input.appointmentId) {
      const { updateMetadataRefs } = await import("./lead.service.ts");
      await updateMetadataRefs(clientCode, lead._id.toString(), {
        appointmentId: input.appointmentId,
      });
    }

    await recalculateScore(clientCode, lead._id.toString());

    // ─── Trigger optional client callback for meeting sync ──────────
    if (input.appointmentId) {
      const secrets = await ClientSecrets.findOne({ clientCode }).lean();
      const callbackUrl = secrets?.getDecrypted(
        "customSecrets.MEETING_CALLBACK_URL",
      );

      if (callbackUrl) {
        console.log(
          `[crmHooks] Triggering meeting callback for ${clientCode}: ${callbackUrl}`,
        );
        sendCallbackWithRetry({
          clientCode,
          callbackUrl: callbackUrl as string,
          method: "POST",
          payload: {
            event: "meeting.created",
            appointmentId: input.appointmentId,
            meetingId: input.meetingId,
            meetLink: input.meetLink,
            meetCode: input.meetCode,
            status: "scheduled",
            timestamp: new Date().toISOString(),
            participant_phone: input.phone, // Added
            participant_name: input.participantName, // Added
            meeting_mode: input.meetingMode, // Added
            amount: input.amount, // Added
          },
        }).catch((err) =>
          console.error(`[crmHooks] Meeting callback failed: ${err.message}`),
        );
      }
    }
  } catch {
    /* Never let CRM errors break meeting creation */
  }
};

// ─── Email sent ───────────────────────────────────────────────────────────────

/**
 * Logs transactional or automation email events into the CRM.
 *
 * @param clientCode - Tenant ID.
 * @param input - Email tracking data.
 * @param input.email - Recipient email.
 * @param input.subject - Subject line.
 * @param input.messageId - (Optional) SMTP/Service message ID.
 * @param input.performedBy - Actor ID.
 *
 * @returns {Promise<void>}
 */
export const onEmailSent = async (
  clientCode: string,
  input: {
    email: string;
    subject: string;
    messageId?: string;
    performedBy?: string;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findOne({ clientCode, email: input.email }).lean();
    if (!lead) return;
    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "email_sent",
      title: `Email: ${input.subject}`,
      metadata: {
        messageId: input.messageId ?? null,
        subject: input.subject,
        email: input.email,
      },
      performedBy: input.performedBy ?? "system",
    });
  } catch {
    /* non-critical */
  }
};

// ─── Payment captured ─────────────────────────────────────────────────────────

/**
 * Handles payment success events, linking them to leads and updating financial metadata.
 *
 * @param clientCode - Tenant ID.
 * @param input - Payment details.
 * @param input.phone - (Optional) To link by phone.
 * @param input.email - (Optional) To link by email.
 * @param input.appointmentId - (Optional) To link by booking reference.
 * @param input.orderId - (Optional) Transaction ID.
 * @param input.amount - Value of the payment.
 * @param input.currency - Currency code (default: INR).
 *
 * @returns {Promise<void>} Updates metadata, logs activity, and emits a global EventBus event.
 *
 * **DETAILED EXECUTION:**
 * 1. **Discovery**: Tries to find the lead using a hierarchy: `appointmentId` > `phone` > `email`.
 * 2. **Financial Update**: Uses `updateMetadataRefs` to store the latest payment amount and currency in the lead's "God View" profile.
 * 3. **Model Sync**: If `appointmentId` is present, it attempts to find a matching `Meeting` record and mark its `paymentStatus` as "paid".
 * 4. **Activity Logging**: Adds a financial record to the timeline.
 * 5. **Bus Emission**: Emits `payment.captured` via `EventBus`, allowing other modules (like automated "Thank You" messages) to react.
 */
export const onPaymentCaptured = async (
  clientCode: string,
  input: {
    phone?: string;
    email?: string;
    appointmentId?: string;
    orderId?: string;
    amount: number;
    currency?: string;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    let lead = null;

    if (input.appointmentId) {
      lead = await Lead.findOne({
        clientCode,
        "metadata.refs.appointmentId": input.appointmentId,
      }).lean();
    }
    if (!lead && input.phone)
      lead = await Lead.findOne({ clientCode, phone: input.phone }).lean();
    if (!lead && input.email)
      lead = await Lead.findOne({ clientCode, email: input.email }).lean();
    if (!lead) return;

    const refs: Record<string, string | null> = {};
    if (input.orderId) refs.orderId = input.orderId;
    if (input.appointmentId) refs.appointmentId = input.appointmentId;

    if (Object.keys(refs).length > 0) {
      const { updateMetadataRefs } = await import("./lead.service.ts");
      await updateMetadataRefs(clientCode, lead._id.toString(), refs, {
        paymentAmount: input.amount,
        paymentCurrency: input.currency ?? "INR",
      });

      // Also update Meeting record if it exists
      if (input.appointmentId) {
        const { Meeting } = await getCrmModels(clientCode);
        await Meeting.updateOne(
          { "metadata.refs.appointmentId": input.appointmentId, clientCode },
          { $set: { paymentStatus: "paid" } },
        );
      }
    }

    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "system",
      title: `Payment captured — ${input.currency ?? "INR"} ${input.amount.toLocaleString()}`,
      metadata: {
        amount: input.amount,
        currency: input.currency ?? "INR",
        orderId: input.orderId ?? null,
        appointmentId: input.appointmentId ?? null,
      },
      performedBy: "system",
    });

    void EventBus.emit(clientCode, "payment.captured", {
      phone: lead.phone,
      email: lead.email,
      data: lead,
      variables: {
        amount: String(input.amount),
        currency: input.currency ?? "INR",
        orderId: input.orderId || "",
        appointmentId: input.appointmentId || "",
        stageId: (lead as any).stageId?.toString(),
      },
    });
  } catch {
    /* non-critical */
  }
};
