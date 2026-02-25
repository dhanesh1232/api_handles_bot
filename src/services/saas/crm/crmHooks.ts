/**
 * crmHooks.ts
 * Thin integration layer — called from whatsappService, meetService, emailService.
 *
 * All DB ops go to the client's own tenant DB via getCrmModels().
 */

import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { logActivity } from "./activity.service.ts";
import { runAutomations } from "./automation.service.ts";
import { recalculateScore } from "./lead.service.ts";

// ─── WhatsApp outbound ────────────────────────────────────────────────────────

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
    const lead = await Lead.findOne({ clientCode, phone: input.phone });
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
    let lead = await Lead.findOne({ clientCode, phone: input.phone });

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
    const lead = await Lead.findOne({ clientCode, phone: input.phone });
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

export const onMeetingCreated = async (
  clientCode: string,
  input: {
    phone: string;
    meetLink: string;
    calendarEventId: string;
    title?: string;
    startTime?: Date;
    appointmentId?: string;
    performedBy?: string;
  },
): Promise<void> => {
  try {
    const { Lead } = await getCrmModels(clientCode);
    const lead = await Lead.findOne({ clientCode, phone: input.phone });
    if (!lead) return;

    await logActivity(clientCode, {
      leadId: lead._id.toString(),
      type: "meeting_created",
      title: `Google Meet: ${input.title ?? "Meeting scheduled"}`,
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
  } catch {
    /* Never let CRM errors break meeting creation */
  }
};

// ─── Email sent ───────────────────────────────────────────────────────────────

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
    const lead = await Lead.findOne({ clientCode, email: input.email });
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
      });
    }
    if (!lead && input.phone)
      lead = await Lead.findOne({ clientCode, phone: input.phone });
    if (!lead && input.email)
      lead = await Lead.findOne({ clientCode, email: input.email });
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

    await runAutomations(clientCode, {
      trigger: "stage_enter",
      lead: lead as unknown as ILead,
      stageId: (lead as any).stageId.toString(),
    });
  } catch {
    /* non-critical */
  }
};
