/**
 * lead.routes.ts — uses withSDK middleware, no per-handler createSDK() calls
 */

import { type Request, type Response, Router } from "express";

const router = Router();
// router.use(withSDK()); // stamps req.sdk once for every route below — MOVED TO PARENT crm.router.ts

// ─── Field Discovery ──────────────────────────────────────────────────────────
router.get("/fields", async (req: Request, res: Response) => {
  try {
    const fields = await req.sdk.lead.fields();
    res.json({ success: true, data: fields });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────
router.post("/leads", async (req: Request, res: Response) => {
  try {
    const { firstName, phone } = req.body;
    if (!firstName?.trim()) {
      res
        .status(400)
        .json({ success: false, message: "firstName is required" });
      return;
    }
    if (!phone?.trim()) {
      res.status(400).json({ success: false, message: "phone is required" });
      return;
    }
    const lead = await req.sdk.lead.create(req.body);
    res.status(201).json({ success: true, data: lead });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    const status = msg.includes("No default pipeline") ? 400 : 500;
    res.status(status).json({ success: false, message: msg });
  }
});

// ─── Upsert ───────────────────────────────────────────────────────────────────
router.post("/leads/upsert", async (req: any, res: any) => {
  try {
    const {
      leadData,
      moduleInfo,
      trigger,
      pipelineId: inputPipelineId,
      stageId: inputStageId,
    } = req.body;
    if (!leadData?.phone) {
      res.status(400).json({ success: false, message: "phone is required" });
      return;
    }

    let finalPipelineId = inputPipelineId;
    let finalStageId = inputStageId;

    if (!finalPipelineId && trigger) {
      const { getCrmModels } = await import("@lib/tenant/crm.models");
      const { CustomEventDef } = await getCrmModels(req.clientCode!);
      const eventDef = await CustomEventDef.findOne({
        clientCode: req.clientCode,
        name: trigger,
        isActive: true,
      }).lean();
      if (eventDef?.pipelineId) {
        finalPipelineId = eventDef.pipelineId;
        finalStageId = eventDef.stageId;
      }
    }

    let lead = await req.sdk.lead.getByPhone(leadData.phone);

    const refs: any = {};
    if (moduleInfo?.type === "service_enrollment" && moduleInfo.id)
      refs.orderId = moduleInfo.id;
    else if (moduleInfo?.type === "doctor_consultation" && moduleInfo.id)
      refs.appointmentId = moduleInfo.id;
    else if (moduleInfo?.type === "product_purchase" && moduleInfo.id)
      refs.orderId = moduleInfo.id;
    else if (moduleInfo?.type === "volunteer_application" && moduleInfo.id)
      refs.volunteerId = moduleInfo.id;
    else if (moduleInfo?.type === "user_registration" && moduleInfo.id)
      refs.userId = moduleInfo.id;

    if (lead) {
      if (finalStageId && lead.stageId?.toString() !== finalStageId) {
        lead = await req.sdk.lead.move(
          lead._id.toString(),
          finalStageId,
          "system_upsert",
        );
      }
      if (Object.keys(refs).length > 0) {
        lead = await req.sdk.lead.updateRefs(lead?._id.toString(), refs);
      }
      if (lead && leadData.message) {
        await req.sdk.activity.createNote(
          lead._id.toString(),
          leadData.message,
          "system_contact_form",
        );
      }

      // Log returning activity directly explicitly passed from frontend API handler
      if (leadData.activityNote) {
        const { getCrmModels } = await import("@lib/tenant/crm.models");
        const { LeadActivity } = await getCrmModels(req.clientCode!);
        await LeadActivity.create({
          clientCode: req.clientCode,
          leadId: lead._id,
          type: "system",
          title: leadData.activityNote,
          metadata: { moduleInfo, trigger },
          performedBy: "system",
        });
      }
    } else {
      const names = (leadData.name || "").trim().split(" ");
      const firstName = names[0] || "Unknown";
      const lastName = names.slice(1).join(" ");

      lead = await req.sdk.lead.create({
        firstName,
        lastName,
        phone: leadData.phone,
        email: leadData.email,
        source: leadData.source || "website",
        pipelineId: finalPipelineId,
        stageId: finalStageId,
        metadata: {
          refs: { ...refs },
          extra: { upsertedAt: new Date().toISOString() },
        },
      });

      if (lead && leadData.message) {
        await req.sdk.activity.createNote(
          lead._id.toString(),
          leadData.message,
          "system_contact_form",
        );
      }
    }

    if (lead && trigger) {
      const { runAutomations } = await import(
        "@/services/saas/crm/automation.service"
      );
      void runAutomations(req.clientCode!, {
        trigger: trigger as any,
        lead: lead as any,
        variables: {
          ...(moduleInfo || {}),
          ...(leadData || {}),
          phone: lead.phone,
          name: lead.firstName,
          fullName: lead.firstName + (lead.lastName ? ` ${lead.lastName}` : ""),
        },
      });
    }

    res.status(200).json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── List ─────────────────────────────────────────────────────────────────────
router.get("/leads", async (req: Request, res: Response) => {
  try {
    const {
      status,
      pipelineId,
      stageId,
      source,
      assignedTo,
      tags,
      minScore,
      search,
      appointmentId,
      bookingId,
      orderId,
      meetingId,
      startDate,
      endDate,
      page,
      limit,
      sortBy,
      sortDir,
    } = req.query as Record<string, string>;

    const filters: LeadListFilters = {};
    if (status) filters.status = status as LeadStatus;
    if (pipelineId) filters.pipelineId = pipelineId;
    if (stageId) filters.stageId = stageId;
    if (source) filters.source = source as LeadSource;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (minScore) filters.minScore = Number(minScore);
    if (search) filters.search = search;
    if (appointmentId) filters.appointmentId = appointmentId;
    if (bookingId) filters.bookingId = bookingId;
    if (orderId) filters.orderId = orderId;
    if (meetingId) filters.meetingId = meetingId;
    if (tags) filters.tags = tags.split(",").map((t) => t.trim());
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const result = await req.sdk.lead.list(filters, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      sortBy: sortBy as any,
      sortDir: sortDir as any,
    });

    res.json({
      success: true,
      data: result.leads,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Leads by stage (board column) ────────────────────────────────────────────
router.get(
  "/pipelines/:pipelineId/stages/:stageId/leads",
  async (req: Request, res: Response) => {
    try {
      const { page, limit } = req.query as Record<string, string>;
      const result = await req.sdk.lead.byStage(
        req.params.pipelineId as string,
        req.params.stageId as string,
        { page: page ? Number(page) : 1, limit: limit ? Number(limit) : 50 },
      );
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

// ─── Get by ID ────────────────────────────────────────────────────────────────
router.get("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    const lead = await req.sdk.lead.getById(req.params.leadId as string);
    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Get by phone ─────────────────────────────────────────────────────────────
router.get("/leads/phone/:phone", async (req: Request, res: Response) => {
  try {
    const lead = await req.sdk.lead.getByPhone(
      decodeURIComponent(req.params.phone as string),
    );
    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Get by metadata ref ──────────────────────────────────────────────────────
router.get(
  "/leads/ref/:refKey/:refValue",
  async (req: Request, res: Response) => {
    try {
      const allowedRefs = [
        "appointmentId",
        "bookingId",
        "orderId",
        "meetingId",
      ];
      if (!allowedRefs.includes(req.params.refKey as string)) {
        res.status(400).json({
          success: false,
          message: `refKey must be one of: ${allowedRefs.join(", ")}`,
        });
        return;
      }
      const lead = await req.sdk.lead.getByRef(
        req.params.refKey as
          | "appointmentId"
          | "bookingId"
          | "orderId"
          | "meetingId",
        req.params.refValue as string,
      );
      if (!lead) {
        res.status(404).json({ success: false, message: "Lead not found" });
        return;
      }
      res.json({ success: true, data: lead });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

// ─── Update ───────────────────────────────────────────────────────────────────
router.patch("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    const lead = await req.sdk.lead.update(
      req.params.leadId as string,
      req.body,
    );
    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Update metadata refs ─────────────────────────────────────────────────────
router.patch("/leads/:leadId/metadata", async (req: Request, res: Response) => {
  try {
    const { refs = {}, extra } = req.body;
    const lead = await req.sdk.lead.updateRefs(
      req.params.leadId as string,
      refs,
      extra,
    );
    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Move stage ───────────────────────────────────────────────────────────────
router.patch("/leads/:leadId/move", async (req: Request, res: Response) => {
  try {
    const { stageId } = req.body;
    if (!stageId) {
      res.status(400).json({ success: false, message: "stageId is required" });
      return;
    }
    const lead = await req.sdk.lead.move(req.params.leadId as string, stageId);
    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Convert ──────────────────────────────────────────────────────────────────
router.post("/leads/:leadId/convert", async (req: Request, res: Response) => {
  try {
    const { outcome, reason } = req.body;
    if (!["won", "lost"].includes(outcome)) {
      res
        .status(400)
        .json({ success: false, message: "outcome must be won or lost" });
      return;
    }
    const lead = await req.sdk.lead.convert(
      req.params.leadId as string,
      outcome,
      reason,
    );
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
router.patch("/leads/:leadId/tags", async (req: Request, res: Response) => {
  try {
    const { add = [], remove = [] } = req.body;
    const lead = await req.sdk.lead.tags(
      req.params.leadId as string,
      add,
      remove,
    );
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Recalculate score ────────────────────────────────────────────────────────
router.post("/leads/:leadId/score", async (req: Request, res: Response) => {
  try {
    await req.sdk.lead.recalcScore(req.params.leadId as string);
    const lead = await req.sdk.lead.getById(req.params.leadId as string);
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Archive ──────────────────────────────────────────────────────────────────
router.delete("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    await req.sdk.lead.archive(req.params.leadId as string);
    res.json({ success: true, message: "Lead archived" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Bulk delete ──────────────────────────────────────────────────────────────
router.delete("/leads", async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res
        .status(400)
        .json({ success: false, message: "ids must be a non-empty array" });
      return;
    }
    await req.sdk.lead.bulkDelete(ids);
    res.json({ success: true, deleted: ids.length });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Bulk import ──────────────────────────────────────────────────────────────
router.post("/leads/import", async (req: Request, res: Response) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      res
        .status(400)
        .json({ success: false, message: "leads array is required" });
      return;
    }
    if (leads.length > 1000) {
      res
        .status(400)
        .json({ success: false, message: "Max 1000 leads per import" });
      return;
    }
    const result = await req.sdk.lead.bulkUpsert(leads);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
