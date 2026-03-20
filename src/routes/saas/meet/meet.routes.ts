/**
 * meet.routes.ts
 *
 * All routes read req.clientCode from validateClientKey middleware.
 * Mount at /api/saas/meet in server.ts
 */

import { type Request, type Response, Router } from "express";
import { Server } from "socket.io";
import { withSDK } from "@/middleware/withSDK";
import * as meetingService from "@/services/saas/meet/meeting.service";

/**
 * @module Routes/Meet
 * @responsibility Google Meet integration and appointment lifecycle management.
 *
 * **GOAL:** Provide an interface for creating, listing, and rescheduling meetings (free or paid) with automated calendar link generation.
 *
 * **DETAILED EXECUTION:**
 * 1. **SDK Injection**: Uses `withSDK(io)` to provide handlers with tenant-aware scheduling capabilities.
 * 2. **Meeting Lifecycle**: Manages states from `pending` to `scheduled` or `cancelled`, including payment status tracking for consultation fees.
 */
export function createMeetRouter(io: Server) {
  const router = Router();

  // Inject SDK with Socket.io
  router.use(withSDK(io));

  /**
   * POST /api/saas/meet
   * Create a new meeting (free or paid) and generate Google Meet link.
   *
   * **GOAL:** Ingest meeting requests, coordinate with Google Calendar/Meet, and store as a billable or free event.
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { leadId, participantName, participantPhone, startTime, endTime } =
        req.body;

      if (
        !leadId ||
        !participantName ||
        !participantPhone ||
        !startTime ||
        !endTime
      ) {
        res.status(400).json({
          success: false,
          message:
            "Missing required fields (leadId, participantName, participantPhone, startTime, endTime)",
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
   * Update meeting status, payment info, or reschedule.
   */
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const { status, paymentStatus, startTime, endTime, duration } = req.body;

      let meeting;

      // Handle Rescheduling
      if (startTime && endTime) {
        meeting = await meetingService.rescheduleMeeting(
          req.clientCode!,
          req.params.id as string,
          {
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            duration: duration || 30,
          },
        );
      }

      // Handle Status/Payment Updates
      if (status || paymentStatus) {
        meeting = await meetingService.updateMeetingStatus(
          req.clientCode!,
          req.params.id as string,
          status,
          paymentStatus,
        );
      }

      if (!meeting) {
        res.status(404).json({ success: false, message: "Meeting not found" });
        return;
      }
      res.json({ success: true, data: meeting });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  });

  return router;
}
