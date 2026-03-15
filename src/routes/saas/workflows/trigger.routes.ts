import { Router } from "express";
import { sendCallbackWithRetry } from "@/lib/callbackSender";
import { getCrmModels } from "@/lib/tenant/crm.models";
import { createLead, getLeadByPhone } from "@/services/saas/crm/lead.service";
import { EventBus } from "@/services/saas/event/eventBus.service";
import { normalizePhone } from "@/utils/phone";

const triggerRouter = Router();

/**
 * POST /api/saas/workflows/trigger
 *
 * Generic event dispatcher. Accepts any named trigger and arbitrary context.
 * All domain actions (meeting creation, WhatsApp, callbacks, etc.) are handled
 * by Automation Rules — nothing is hardcoded here.
 *
 * Body:
 *   trigger          string   — event name, no spaces, max 100 chars
 *   phone            string   — E.164 digits only (normalized server-side)
 *   email?           string   — optional contact email
 *   variables?       Record<string, string> — flat KV pairs accessible as {{vars.key}}
 *   data?            Record<string, any>    — structured event data (flattened to data.key)
 *   callbackUrl?     string   — receives { status, eventLogId, rulesMatched } after processing
 *   callbackMetadata? any     — extra metadata echoed back in callback
 *   createLeadIfMissing? bool — auto-create lead if not found
 *   leadData?        { firstName?, lastName?, source? } — used only if createLeadIfMissing
 */
triggerRouter.post("/trigger", async (req: any, res: any) => {
  const clientCode = req.clientCode;
  if (!clientCode) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const {
    trigger,
    phone: rawPhone,
    email,
    variables,
    data,
    callbackUrl,
    callbackMetadata,
    createLeadIfMissing,
    leadData,
  } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────

  if (!trigger || !rawPhone) {
    return res.status(400).json({
      success: false,
      message: "trigger and phone are required",
      code: "MISSING_REQUIRED",
    });
  }

  if (
    typeof trigger !== "string" ||
    /\s/.test(trigger) ||
    trigger.length > 100
  ) {
    return res.status(400).json({
      success: false,
      message: "trigger must be a single string with no spaces, max 100 chars",
      code: "INVALID_TRIGGER",
    });
  }

  const phone = normalizePhone(rawPhone);
  if (!phone || phone.length < 10) {
    return res.status(400).json({
      success: false,
      message: "Invalid phone format. Provide a valid number e.g. 919876543210",
      code: "INVALID_PHONE",
    });
  }

  // ── Processing ────────────────────────────────────────────────────────────

  const { EventLog, AutomationRule } = await getCrmModels(clientCode);

  // Sanitize payload before logging — strip undefined values
  const sanitizedPayload = JSON.parse(
    JSON.stringify({ trigger, phone, email, variables, data }),
  );

  let eventLog: any;
  try {
    // 1. Log the incoming event
    eventLog = await EventLog.create({
      clientCode,
      trigger,
      phone,
      email,
      status: "received",
      callbackUrl,
      payload: sanitizedPayload,
    });

    // 2. Find or auto-create Lead
    let lead = await getLeadByPhone(clientCode, phone);

    // Dynamic Trigger Mapping via CustomEventDef
    const { CustomEventDef } = await getCrmModels(clientCode);
    const eventDef = await CustomEventDef.findOne({
      clientCode,
      name: trigger,
      isActive: true,
    });
    const mappedTrigger = (eventDef as any)?.mapsTo || trigger;

    if (!lead && createLeadIfMissing) {
      lead = await createLead(clientCode, {
        firstName: leadData?.firstName || phone,
        lastName: leadData?.lastName || "",
        email: email || "",
        phone,
        source: (leadData?.source as LeadSource) || "webhook",
        // If mapsTo is lead_created, we might want to pass more context
      });
    }

    if (!lead) {
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "failed",
        error: "Lead not found and createLeadIfMissing is false",
      });
      return res.status(404).json({
        success: false,
        message: "Lead not found",
        code: "LEAD_NOT_FOUND",
        hint: "Pass createLeadIfMissing: true to auto-create one",
      });
    }

    // 3. Count matching rules
    const rulesMatched = await AutomationRule.countDocuments({
      clientCode,
      trigger: { $in: [trigger, mappedTrigger] },
      isActive: true,
    });

    await EventLog.findByIdAndUpdate(eventLog._id, {
      rulesMatched,
      status: "processing",
    });

    // 4. Send immediate acknowledgment callback
    if (callbackUrl) {
      void sendCallbackWithRetry({
        clientCode,
        callbackUrl,
        payload: {
          status: "processing",
          trigger,
          rulesMatched,
          eventLogId: eventLog._id.toString(),
          metadata: callbackMetadata ?? {},
        },
      });
      await EventLog.findByIdAndUpdate(eventLog._id, {
        callbackStatus: "sent",
      });
    }

    // 5. Build unified event variables context
    //    Merges: explicit vars + flattened data object + system fields
    const _eventVariables: Record<string, string> = {
      ...(variables || {}),
      phone,
      email: email ?? "",
      trigger,
      ...(data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)]),
          )
        : {}),
    };

    // 6. Emit event via EventBus
    // EventBus handles:
    // - Lead resolution/creation (though we did it above for immediate validation)
    // - Rule matching
    // - Execution (via runAutomations)
    // - Logging & Idempotency
    const result = await EventBus.emit(
      clientCode,
      trigger,
      {
        phone,
        email,
        variables,
        data,
      },
      {
        createLeadIfMissing,
        leadData: leadData
          ? {
              ...leadData,
              source: (leadData?.source as LeadSource) || "webhook",
            }
          : undefined,
        delayMinutes:
          Number(req.body.delaySeconds || 0) / 60 || req.body.delayMinutes,
        runAt: req.body.runAt,
      },
    );

    return res.json({
      success: true,
      data: {
        eventLogId: result?._id?.toString(),
        trigger,
        leadId: lead._id.toString(),
        rulesMatched: result?.rulesMatched || rulesMatched,
      },
    });
  } catch (err: any) {
    if (eventLog) {
      await EventLog.findByIdAndUpdate(eventLog._id, {
        status: "failed",
        error: err.message,
      }).catch(() => {});
    }

    console.error("[triggerRoute] Error:", {
      clientCode,
      trigger: req.body?.trigger,
      phone,
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
