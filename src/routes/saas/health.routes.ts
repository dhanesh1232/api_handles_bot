import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";

const router = Router();

/**
 * GET /api/saas/health
 */
router.get("/health", (req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  let dbStatus = "disconnected";
  if (dbState === 1) dbStatus = "connected";
  else if (dbState === 2) dbStatus = "connecting";
  else if (dbState === 3) dbStatus = "disconnecting";

  res.json({
    status: "ok",
    db: dbStatus,
    uptime: process.uptime(),
  });
});

/**
 * GET /api/saas/jobs/status/:jobId
 */
router.get("/jobs/status/:jobId", async (req: Request, res: Response) => {
  try {
    const { default: Job } = await import("../../model/queue/job.model.ts");
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      res.status(404).json({ success: false, message: "Job not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        id: job._id,
        state: job.status,
        progress: 0, // Not tracked in MongoQueue
        failedReason: job.lastError,
        returnvalue: null, // Not tracked in MongoQueue
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
