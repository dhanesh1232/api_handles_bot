/**
 * lead.routes.ts
 *
 * Place at: src/routes/saas/crm/lead.routes.ts
 * Mount in server.ts: app.use("/api/crm", leadRouter)
 *
 * All routes read req.clientCode from your validateClientKey middleware.
 */

import { Router, type Request, type Response } from "express";
import * as leadService from "../../../services/saas/crm/lead.service.ts";

const router = Router();

// ─── Create lead ──────────────────────────────────────────────────────────────
/**
 * POST /api/crm/leads
 *
 * Minimal request (auto-assigns default pipeline + stage):
 * {
 *   "firstName": "Suresh",
 *   "phone": "+919876543210"
 * }
 *
 * Full request with metadata refs:
 * {
 *   "firstName": "Suresh",
 *   "lastName": "Rao",
 *   "phone": "+919876543210",
 *   "email": "suresh@hospital.in",
 *   "source": "website",
 *   "dealValue": 120000,
 *   "dealTitle": "OPD Automation - City Hospital",
 *   "pipelineId": "6789abc...",   ← optional, uses default if omitted
 *   "stageId": "6789def...",      ← optional, uses stage.isDefault if omitted
 *   "metadata": {
 *     "refs": {
 *       "appointmentId": "6789aaa...",   ← stored as ObjectId
 *       "bookingId": "6789bbb..."        ← stored as ObjectId
 *     },
 *     "extra": {
 *       "appointmentDate": "2026-03-01",
 *       "plan": "Premium"
 *     }
 *   }
 * }
 *
 * Response includes populated pipeline + stage:
 * {
 *   "_id": "...",
 *   "pipelineId": { "_id": "...", "name": "Patient Journey" },
 *   "stageId":    { "_id": "...", "name": "Inquiry", "color": "#6366f1", "probability": 10 },
 *   "metadata": {
 *     "refs": {
 *       "appointmentId": "6789aaa...",   ← ObjectId, client can query their DB with this
 *       "bookingId": "6789bbb..."
 *     },
 *     "extra": { ... }
 *   }
 * }
 */
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

    const lead = await leadService.createLead(req.clientCode!, req.body);
    res.status(201).json({ success: true, data: lead });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    const status = msg.includes("No default pipeline") ? 400 : 500;
    res.status(status).json({ success: false, message: msg });
  }
});

// ─── List leads ───────────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads
 *
 * Query params:
 *   status         = open | won | lost | archived
 *   pipelineId     = ObjectId
 *   stageId        = ObjectId
 *   source         = website | whatsapp | ...
 *   assignedTo     = string
 *   tags           = tag1,tag2   (comma-separated)
 *   minScore       = number
 *   search         = "suresh"    (searches name, email, phone, dealTitle)
 *   appointmentId  = ObjectId    → filter by metadata.refs.appointmentId
 *   bookingId      = ObjectId    → filter by metadata.refs.bookingId
 *   orderId        = ObjectId    → filter by metadata.refs.orderId
 *   meetingId      = ObjectId    → filter by metadata.refs.meetingId
 *   page           = 1
 *   limit          = 25
 *   sortBy         = score | createdAt | updatedAt | dealValue | lastContactedAt
 *   sortDir        = asc | desc
 */
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

    const result = await leadService.listLeads(req.clientCode!, filters, {
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

// ─── Get leads for a board column ─────────────────────────────────────────────
/**
 * GET /api/crm/pipelines/:pipelineId/stages/:stageId/leads
 * Used by the Kanban board to load leads per column (with pagination).
 */
router.get(
  "/pipelines/:pipelineId/stages/:stageId/leads",
  async (req: Request, res: Response) => {
    try {
      const { page, limit } = req.query as Record<string, string>;
      const result = await leadService.getLeadsByStage(
        req.clientCode!,
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

// ─── Get single lead ──────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads/:leadId
 * Returns lead with populated pipelineId and stageId (name, color, probability).
 * metadata.refs ObjectIds returned as strings — client resolves them in own DB.
 */
router.get("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    const lead = await leadService.getLeadById(
      req.clientCode!,
      req.params.leadId as string,
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

// ─── Get lead by phone ────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads/phone/:phone
 * Used by your WhatsApp webhook to find the CRM lead when a message arrives.
 */
router.get("/leads/phone/:phone", async (req: Request, res: Response) => {
  try {
    const lead = await leadService.getLeadByPhone(
      req.clientCode!,
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

// ─── Get lead by metadata ref ──────────────────────────────────────────────────
/**
 * GET /api/crm/leads/ref/:refKey/:refValue
 * Find the lead that has a specific ObjectId in metadata.refs.
 *
 * Example:
 *   GET /api/crm/leads/ref/appointmentId/6789abc...
 *   → returns the lead whose metadata.refs.appointmentId = 6789abc...
 *
 * Useful when: a payment webhook fires with an appointmentId, and you need
 * to find and update the linked CRM lead.
 */
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

      const lead = await leadService.getLeadByRef(
        req.clientCode!,
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

// ─── Update lead fields ───────────────────────────────────────────────────────
/**
 * PATCH /api/crm/leads/:leadId
 * Update name, email, source, dealValue, assignedTo, etc.
 * Does NOT handle stage changes — use the /move endpoint for that.
 */
router.patch("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    const lead = await leadService.updateLead(
      req.clientCode!,
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
/**
 * PATCH /api/crm/leads/:leadId/metadata
 * Add or update ObjectId refs and/or extra plain-value data.
 *
 * Body:
 * {
 *   "refs": {
 *     "appointmentId": "6789abc...",   ← stored as ObjectId
 *     "meetingId": "6789def...",       ← stored as ObjectId
 *     "bookingId": null                ← null = remove this ref
 *   },
 *   "extra": {
 *     "appointmentDate": "2026-03-01",
 *     "plan": "Premium",
 *     "oldKey": null                   ← null = remove this key
 *   }
 * }
 */
router.patch("/leads/:leadId/metadata", async (req: Request, res: Response) => {
  try {
    const { refs = {}, extra } = req.body;

    const lead = await leadService.updateMetadataRefs(
      req.clientCode!,
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

// ─── Move lead to a different stage ──────────────────────────────────────────
/**
 * PATCH /api/crm/leads/:leadId/move
 * Drag-and-drop on the Kanban board.
 * Auto-logs a stage_change activity.
 * If target stage.isWon → status becomes "won". If isLost → "lost".
 *
 * Body: { "stageId": "6789abc..." }
 */
router.patch("/leads/:leadId/move", async (req: Request, res: Response) => {
  try {
    const { stageId } = req.body;
    if (!stageId) {
      res.status(400).json({ success: false, message: "stageId is required" });
      return;
    }
    const lead = await leadService.moveLead(
      req.clientCode!,
      req.params.leadId as string,
      stageId,
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

// ─── Convert lead (won / lost) ────────────────────────────────────────────────
/**
 * POST /api/crm/leads/:leadId/convert
 * Body: { "outcome": "won" | "lost", "reason": "..." }
 */
router.post("/leads/:leadId/convert", async (req: Request, res: Response) => {
  try {
    const { outcome, reason } = req.body;
    if (!["won", "lost"].includes(outcome)) {
      res
        .status(400)
        .json({ success: false, message: "outcome must be won or lost" });
      return;
    }
    const lead = await leadService.convertLead(
      req.clientCode!,
      req.params.leadId as string,
      outcome,
      reason,
    );
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Update tags ──────────────────────────────────────────────────────────────
/**
 * PATCH /api/crm/leads/:leadId/tags
 * Body: { "add": ["hot", "vip"], "remove": ["cold"] }
 */
router.patch("/leads/:leadId/tags", async (req: Request, res: Response) => {
  try {
    const { add = [], remove = [] } = req.body;
    const lead = await leadService.updateTags(
      req.clientCode!,
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
/**
 * POST /api/crm/leads/:leadId/score
 * Manually trigger score recalculation. Normally called automatically.
 */
router.post("/leads/:leadId/score", async (req: Request, res: Response) => {
  try {
    await leadService.recalculateScore(
      req.clientCode!,
      req.params.leadId as string,
    );
    const lead = await leadService.getLeadById(
      req.clientCode!,
      req.params.leadId as string,
    );
    res.json({ success: true, data: lead });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Archive lead ─────────────────────────────────────────────────────────────
/**
 * DELETE /api/crm/leads/:leadId
 * Soft delete — sets isArchived: true, status: "archived".
 */
router.delete("/leads/:leadId", async (req: Request, res: Response) => {
  try {
    await leadService.archiveLead(req.clientCode!, req.params.leadId as string);
    res.json({ success: true, message: "Lead archived" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Bulk import ──────────────────────────────────────────────────────────────
/**
 * POST /api/crm/leads/import
 * Upsert multiple leads by phone. If phone exists → update. If not → create.
 *
 * Body: { "leads": [ { firstName, phone, metadata: { refs: { appointmentId } } }, ... ] }
 * Response: { created: 5, updated: 3, failed: 0 }
 */
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
    const result = await leadService.bulkUpsertLeads(req.clientCode!, leads);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
