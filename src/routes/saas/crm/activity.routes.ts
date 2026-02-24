/**
 * activity.routes.ts
 * Timeline, manual activity logging, notes CRUD.
 * Place at: src/routes/saas/crm/activity.routes.ts
 */

import { Router, type Request, type Response } from "express";
import * as activityService from "../../../services/saas/crm/activity.service.ts";

const router = Router();

// ─── Unified timeline ─────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads/:leadId/timeline
 * Activities + notes merged, sorted newest first.
 * Query: page, limit
 */
router.get("/leads/:leadId/timeline", async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await activityService.getTimeline(
      req.clientCode!,
      req.params.leadId as string,
      { page: page ? Number(page) : 1, limit: limit ? Number(limit) : 50 },
    );
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Activities ───────────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads/:leadId/activities
 * Query: type, page, limit
 */
router.get("/leads/:leadId/activities", async (req: Request, res: Response) => {
  try {
    const { type, page, limit } = req.query as Record<string, string>;
    const result = await activityService.getActivities(
      req.clientCode!,
      req.params.leadId as string,
      {
        type: type as activityService.LogActivityInput["type"],
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
      },
    );
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/leads/:leadId/activities
 * Log a manual activity (call, meeting, custom).
 * Body: { type, title, body?, metadata?, performedBy? }
 */
router.post("/leads/:leadId/activities", async (req: Request, res: Response) => {
  try {
    const { type, title, body, metadata, performedBy } = req.body;
    if (!type || !title) {
      res.status(400).json({ success: false, message: "type and title are required" });
      return;
    }
    const activity = await activityService.logActivity(req.clientCode!, {
      leadId: req.params.leadId as string,
      type, title, body, metadata, performedBy,
    });
    res.status(201).json({ success: true, data: activity });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/leads/:leadId/calls
 * Shortcut to log a phone call.
 * Body: { durationMinutes, summary, outcome?, performedBy? }
 */
router.post("/leads/:leadId/calls", async (req: Request, res: Response) => {
  try {
    const { durationMinutes, summary, outcome, performedBy } = req.body;
    if (!summary) {
      res.status(400).json({ success: false, message: "summary is required" });
      return;
    }
    const activity = await activityService.logCall(
      req.clientCode!,
      req.params.leadId as string,
      { durationMinutes: durationMinutes ?? 0, summary, outcome, performedBy },
    );
    res.status(201).json({ success: true, data: activity });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Notes ────────────────────────────────────────────────────────────────────
/**
 * GET /api/crm/leads/:leadId/notes
 * Returns all notes — pinned first, then newest.
 */
router.get("/leads/:leadId/notes", async (req: Request, res: Response) => {
  try {
    const notes = await activityService.getNotes(req.clientCode!, req.params.leadId as string);
    res.json({ success: true, data: notes });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/leads/:leadId/notes
 * Body: { content, createdBy? }
 */
router.post("/leads/:leadId/notes", async (req: Request, res: Response) => {
  try {
    const { content, createdBy } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "content is required" });
      return;
    }
    const note = await activityService.createNote(
      req.clientCode!, req.params.leadId as string, content.trim(), createdBy,
    );
    res.status(201).json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/notes/:noteId
 * Edit note content.
 * Body: { content }
 */
router.patch("/notes/:noteId", async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "content is required" });
      return;
    }
    const note = await activityService.updateNote(req.clientCode!, req.params.noteId as string, content.trim());
    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }
    res.json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/notes/:noteId/pin
 * Toggle pin status.
 */
router.patch("/notes/:noteId/pin", async (req: Request, res: Response) => {
  try {
    const note = await activityService.togglePin(req.clientCode!, req.params.noteId as string);
    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }
    res.json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * DELETE /api/crm/notes/:noteId
 */
router.delete("/notes/:noteId", async (req: Request, res: Response) => {
  try {
    await activityService.deleteNote(req.clientCode!, req.params.noteId as string);
    res.json({ success: true, message: "Note deleted" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;