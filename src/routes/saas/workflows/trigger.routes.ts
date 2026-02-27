import { Router } from "express";
import { crmQueue } from "../../../jobs/saas/crmWorker.ts";
import { sendCallbackWithRetry } from "../../../lib/callbackSender.ts";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { EventLog } from "../../../model/saas/event/eventLog.model.ts";
import { runAutomations } from "../../../services/saas/crm/automation.service.ts";
import {
  createLead,
  getLeadByPhone,
} from "../../../services/saas/crm/lead.service.ts";
import { createGoogleMeetService } from "../../../services/saas/meet/google.meet.service.ts";

const triggerRouter = Router();

triggerRouter.post("/trigger", async (req: any, res: any) => {
  const clientCode = req.clientCode;
  if (!clientCode) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const body = req.body;
  const {
    trigger,
    phone,
    email,
    variables,
    data,
    requiresMeet,
    meetConfig,
    callbackUrl,
    callbackMetadata,
    delayMinutes,
    createLeadIfMissing,
    leadData,
  } = body;

  if (!trigger || !phone) {
    return res.status(400).json({
      success: false,
      message: "trigger and phone are required",
      code: "MISSING_REQUIRED",
    });
  }

  // Phone must be E.164 format (digits only, 10-15 chars)
  const phoneRegex = /^\d{10,15}$/;
  if (!phoneRegex.test(phone.replace(/^\+/, ""))) {
    return res.status(400).json({
      success: false,
      message: "Invalid phone format. Use E.164 format e.g. 919876543210",
      code: "INVALID_PHONE",
    });
  }

  // Trigger must be a non-empty string, no spaces
  if (
    typeof trigger !== "string" ||
    trigger.includes(" ") ||
    trigger.length > 50
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid trigger name. Must be a string with no spaces, max 50 chars.",
      code: "INVALID_TRIGGER",
    });
  }

  // Sanitize payload — remove any keys with undefined values before logging
  const sanitizedPayload = JSON.parse(
    JSON.stringify({ trigger, phone, email, variables, data, requiresMeet }),
  );

  let eventLog;
  try {
    // Step 2 — Create EventLog with status "received"
    eventLog = await EventLog.create({
      clientCode,
      trigger,
      phone,
      email,
      status: "received",
      callbackUrl: body.callbackUrl,
      payload: sanitizedPayload,
    });

    // Step 3 — Find or create lead
    let lead = await getLeadByPhone(clientCode, phone);
    if (!lead && createLeadIfMissing) {
      lead = await createLead(clientCode, {
        firstName: leadData?.firstName || phone,
        lastName: leadData?.lastName || "",
        email: email || "",
        phone: phone,
        source: leadData?.source || "webhook",
      });
    }

    if (!lead) {
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "failed",
        error: "Lead not found and createLeadIfMissing is false",
      });
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }

    // Step 4 — Generate Google Meet if requiresMeet: true
    let meetLink: string | null = null;
    let meetWarning: string | undefined;
    if (requiresMeet) {
      const meetService = createGoogleMeetService();
      const meetResult = await meetService.createMeeting(clientCode, {
        summary: meetConfig?.title ?? `Meeting for ${trigger}`,
        start: meetConfig?.startTime ?? new Date().toISOString(),
        end: new Date(
          Date.now() + (meetConfig?.durationMinutes ?? 30) * 60000,
        ).toISOString(),
        attendees: meetConfig?.attendeeEmail ? [meetConfig.attendeeEmail] : [],
        description: `Trigger: ${trigger}, Phone: ${phone}`,
      });

      if (meetResult.success && meetResult.hangoutLink) {
        meetLink = meetResult.hangoutLink;
      } else {
        // Don't fail the whole request but surface the reason to the caller.
        meetWarning = (meetResult as any).error ?? "Meet creation failed";
        console.warn(
          `[trigger] Meet creation failed for ${clientCode}: ${meetWarning}`,
        );
      }
      // Update eventLog with meetLink
      await EventLog.findByIdAndUpdate(eventLog._id, { meetLink });
    }

    // Step 5 — Count matching rules
    const { AutomationRule } = await getCrmModels(clientCode);
    const rulesMatched = await AutomationRule.countDocuments({
      clientCode,
      trigger,
      isActive: true,
    });

    await EventLog.findByIdAndUpdate(eventLog._id, {
      rulesMatched,
      status: "processing",
    });

    // Step 6 — Send immediate callback to client (status: queued)
    if (callbackUrl) {
      void sendCallbackWithRetry({
        clientCode,
        callbackUrl,
        payload: {
          status: "queued",
          trigger,
          meetLink,
          rulesMatched,
          metadata: callbackMetadata ?? {},
          eventLogId: eventLog._id.toString(),
        },
      });
      await EventLog.findByIdAndUpdate(eventLog._id, {
        callbackStatus: "sent",
      });
    }

    // Step 7 — Run automations (with delay support)
    // Build unified context — merge all sources
    const enrichedVariables = {
      ...(variables || {}), // explicit vars from client
      meetLink: meetLink ?? "", // auto-injected meet link
      phone,
      email: email ?? "",
      trigger,
      ...(data // flatten event data into vars
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [`data.${k}`, String(v)]),
          )
        : {}),
    };

    if ((delayMinutes ?? 0) > 0) {
      await crmQueue.add(
        {
          clientCode,
          type: "crm.automation_event",
          payload: {
            trigger,
            leadId: lead._id.toString(),
            variables: enrichedVariables,
          },
        },
        { delayMs: (delayMinutes ?? 0) * 60 * 1000 },
      );
    } else {
      await runAutomations(clientCode, {
        trigger: trigger as any,
        lead: lead as any,
        variables: enrichedVariables,
      });
    }

    // Step 8 — Finalize EventLog
    await EventLog.findByIdAndUpdate(eventLog._id, {
      status: "completed",
      processedAt: new Date(),
      jobsCreated: rulesMatched,
    });

    // Step 9 — Return response
    return res.json({
      success: true,
      data: {
        eventLogId: eventLog._id.toString(),
        trigger,
        leadId: lead._id.toString(),
        meetLink,
        ...(meetWarning ? { meetWarning } : {}),
        rulesMatched,
        scheduled: (delayMinutes ?? 0) > 0,
      },
    });
  } catch (err: any) {
    if (eventLog) {
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "failed",
        error: err.message,
      }).catch(() => {}); // non-fatal
    }

    console.error("[triggerRoute] Error:", {
      clientCode: req.clientCode,
      trigger: req.body?.trigger,
      phone: req.body?.phone,
      error: err.message,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });

    const statusCode = err.message?.includes("not found")
      ? 404
      : err.message?.includes("Unauthorized")
        ? 401
        : err.message?.includes("not configured")
          ? 422
          : 500;

    return res.status(statusCode).json({
      success: false,
      message: err.message,
      code: err.name ?? "TRIGGER_FAILED",
    });
  }
});

export default triggerRouter;
