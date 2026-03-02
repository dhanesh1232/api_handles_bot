/**
 * meet.routes.ts
 *
 * All routes read req.clientCode from validateClientKey middleware.
 * Mount at /api/saas/meet in server.ts
 */

import { Router, type Request, type Response } from "express";
import * as meetingService from "../../../services/saas/meet/meeting.service.ts";

const router = Router();

/**
 * POST /api/saas/meet
 * Create a new meeting (free or paid) and generate Google Meet link.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      leadId,
      patientName,
      patientPhone,
      startTime,
      endTime,
      duration,
      type,
    } = req.body;

    if (!leadId || !patientName || !patientPhone || !startTime || !endTime) {
      res.status(400).json({
        success: false,
        message:
          "Missing required fields (leadId, patientName, patientPhone, startTime, endTime)",
      });
      return;
    }

    const meeting = await meetingService.createMeeting(
      req.clientCode!,
      req.body,
    );
    res.status(201).json({ success: true, data: meeting });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/saas/meet
 * List meetings with optional filters.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { leadId, status } = req.query as Record<string, string>;
    const meetings = await meetingService.listMeetings(req.clientCode!, {
      leadId: leadId as string,
      status: status as string,
    });
    res.json({ success: true, data: meetings });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/saas/meet/:id
 * Get details of a specific meeting.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const meeting = await meetingService.getMeetingById(
      req.clientCode!,
      req.params.id as string,
    );
    if (!meeting) {
      res.status(404).json({ success: false, message: "Meeting not found" });
      return;
    }
    res.json({ success: true, data: meeting });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/saas/meet/:id
 * Update meeting status or payment info.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { status, paymentStatus } = req.body;
    const meeting = await meetingService.updateMeetingStatus(
      req.clientCode!,
      req.params.id as string,
      status,
      paymentStatus,
    );
    if (!meeting) {
      res.status(404).json({ success: false, message: "Meeting not found" });
      return;
    }
    res.json({ success: true, data: meeting });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
