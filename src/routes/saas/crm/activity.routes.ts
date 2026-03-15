/**
 * activity.routes.ts — uses withSDK middleware, no per-handler createSDK() calls
 */

import { type Request, type Response, Router } from "express";
import { withSDK } from "@/middleware/withSDK";

// LogActivityInput is now global

const router = Router();
router.use(withSDK()); // stamps req.sdk once for every route below

// ─── Unified timeline ─────────────────────────────────────────────────────────
router.get("/leads/:leadId/timeline", async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await req.sdk.activity.timeline(
      req.params.leadId as string,
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
      },
    );
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Activities ───────────────────────────────────────────────────────────────
router.get("/leads/:leadId/activities", async (req: Request, res: Response) => {
  try {
    const { type, page, limit } = req.query as Record<string, string>;
    const result = await req.sdk.activity.list(req.params.leadId as string, {
      type: type as LogActivityInput["type"],
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.post(
  "/leads/:leadId/activities",
  async (req: Request, res: Response) => {
    try {
      const { type, title, body, metadata, performedBy } = req.body;
      if (!type || !title) {
        res
          .status(400)
          .json({ success: false, message: "type and title are required" });
        return;
      }
      const activity = await req.sdk.activity.log({
        leadId: req.params.leadId as string,
        type,
        title,
        body,
        metadata,
        performedBy,
      });
      res.status(201).json({ success: true, data: activity });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.post("/leads/:leadId/calls", async (req: Request, res: Response) => {
  try {
    const { durationMinutes, summary, outcome, performedBy } = req.body;
    if (!summary) {
      res.status(400).json({ success: false, message: "summary is required" });
      return;
    }
    const activity = await req.sdk.activity.logCall(
      req.params.leadId as string,
      {
        durationMinutes: durationMinutes ?? 0,
        summary,
        outcome,
        performedBy,
      },
    );
    res.status(201).json({ success: true, data: activity });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Notes ────────────────────────────────────────────────────────────────────
router.get("/leads/:leadId/notes", async (req: Request, res: Response) => {
  try {
    const notes = await req.sdk.activity.getNotes(req.params.leadId as string);
    res.json({ success: true, data: notes });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.post("/leads/:leadId/notes", async (req: Request, res: Response) => {
  try {
    const { content, createdBy } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "content is required" });
      return;
    }
    const note = await req.sdk.activity.createNote(
      req.params.leadId as string,
      content.trim(),
      createdBy,
    );
    res.status(201).json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.patch("/notes/:noteId", async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ success: false, message: "content is required" });
      return;
    }
    const note = await req.sdk.activity.updateNote(
      req.params.noteId as string,
      content.trim(),
    );
    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }
    res.json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.patch("/notes/:noteId/pin", async (req: Request, res: Response) => {
  try {
    const note = await req.sdk.activity.togglePin(req.params.noteId as string);
    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }
    res.json({ success: true, data: note });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.delete("/notes/:noteId", async (req: Request, res: Response) => {
  try {
    await req.sdk.activity.deleteNote(req.params.noteId as string);
    res.json({ success: true, message: "Note deleted" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
