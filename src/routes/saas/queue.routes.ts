/**
 * @module Routes/QueueAdmin
 * @responsibility High-level administrative control over the asynchronous job ecosystem.
 *
 * **GOAL:** Provide visibility and recovery mechanisms for "stuck" or failed background tasks across all tenants.
 *
 * **DETAILED EXECUTION:**
 * 1. **Dead-Letter Analysis**: The `/failed` endpoint allows admins to paginate through jobs that have exhausted their retry attempts.
 * 2. **Fleet Stats**: The `/stats` endpoint uses MongoDB Aggregation to provide a real-time matrix of job states (pending, failed, completed) grouped by queue name.
 * 3. **Recovery (Retry)**: The `/:jobId/retry` endpoint performs an atomic state reset, shifting a job back to `waiting` and resetting attempts to `0` for re-execution.
 *
 * **SECURITY:** Enforces a strict `x-core-api-key` check, bypassing the standard tenant-key auth for system-level access.
 */

import { type Request, type Response, Router } from "express";
import { ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const router = Router();

// ─── Core API key guard (queue admin only) ────────────────────────────────────
router.use((req: Request, _res: Response, next) => {
  const key = req.headers["x-core-api-key"];
  if (!key || key !== process.env.CORE_API_KEY) {
    next(new ForbiddenError("Invalid core API key"));
    return;
  }
  next();
});

// Lazy-load Job model to avoid import cycles
async function getJobModel() {
  const { default: Job } = await import("@/model/queue/job.model");
  return Job;
}

// ─── GET /failed ──────────────────────────────────────────────────────────────
router.get("/failed", async (req: Request, res: Response, next) => {
  try {
    const {
      queue,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;
    const Job = await getJobModel();

    const filter: Record<string, unknown> = { status: "failed" };
    if (queue) filter.queue = queue;

    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .sort({ failedAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Job.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────
router.get("/stats", async (_req: Request, res: Response, next) => {
  try {
    const Job = await getJobModel();

    const stats = await Job.aggregate([
      {
        $group: {
          _id: { queue: "$queue", status: "$status" },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.queue",
          statuses: {
            $push: { status: "$_id.status", count: "$count" },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// ─── POST /:jobId/retry ───────────────────────────────────────────────────────
router.post("/:jobId/retry", async (req: Request, res: Response, next) => {
  try {
    const Job = await getJobModel();
    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.jobId,
        status: "failed",
      },
      {
        $set: {
          status: "waiting",
          attempts: 0,
          lastError: undefined,
          failedAt: undefined,
          runAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );

    if (!job) {
      res.status(404).json({
        success: false,
        message: "Job not found or not in failed state",
      });
      return;
    }

    logger.info(
      { jobId: req.params.jobId, queue: job.queue },
      "[Admin] Job re-queued",
    );
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /:jobId ───────────────────────────────────────────────────────────
router.delete("/:jobId", async (req: Request, res: Response, next) => {
  try {
    const Job = await getJobModel();
    const job = await Job.findByIdAndDelete(req.params.jobId);
    if (!job) {
      res.status(404).json({ success: false, message: "Job not found" });
      return;
    }

    logger.info({ jobId: req.params.jobId }, "[Admin] Job deleted");
    res.json({ success: true, message: "Job deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
