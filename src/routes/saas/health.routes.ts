import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { dbConnect } from "../../lib/config.ts";
import { validateClientKey } from "../../middleware/saasAuth.ts";

const router = Router();

// Read version from npm/pnpm runtime env (set automatically when started via package.json scripts)
// Falls back to "unknown" if run directly without pnpm
const VERSION: string = process.env.npm_package_version ?? "unknown";

/**
 * GET /api/saas/health
 * Public — no auth required. Used by load balancer health checks and monitoring.
 */
router.get("/health", async (req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  let dbStatus = "disconnected";
  if (dbState === 1) dbStatus = "connected";
  else if (dbState === 2) dbStatus = "connecting";
  else if (dbState === 3) dbStatus = "disconnecting";

  let queueDepth = 0;
  try {
    const { default: Job } = await import("../../model/queue/job.model.ts");
    queueDepth = await Job.countDocuments({ status: { $in: ["pending", "processing"] } });
  } catch {
    // Non-fatal — queue depth is best-effort
  }

  res.json({
    success: true,
    data: {
      status: "ok",
      version: VERSION,
      env: process.env.NODE_ENV ?? "development",
      uptime: Math.floor(process.uptime()),
      db: dbStatus,
      queueDepth,
    },
  });
});

/**
 * GET /api/saas/health/client
 * Client-specific health — requires validateClientKey
 */
router.get(
  "/health/client",
  validateClientKey,
  async (req: Request, res: Response) => {
    try {
      const clientCode = (req as any).clientCode as string;
      await dbConnect("services");

      const { ClientSecrets } = await import("../../model/clients/secrets.ts");
      const { default: Job } = await import("../../model/queue/job.model.ts");
      const { getCrmModels } =
        await import("../../lib/tenant/get.crm.model.ts");

      const [secrets, queueDepth] = await Promise.all([
        ClientSecrets.findOne({ clientCode }),
        Job.countDocuments({
          "data.clientCode": clientCode,
          status: "waiting",
        }),
      ]);

      // Check which services are configured
      const whatsappToken = secrets?.getDecrypted("whatsappToken");
      const smtpHost = secrets?.getDecrypted("smtpHost");
      const emailApiKey = secrets?.getDecrypted("emailApiKey");
      const googleRefreshToken = secrets?.getDecrypted("googleRefreshToken");

      let activeAutomations = 0;
      try {
        const { AutomationRule } = await getCrmModels(clientCode);
        activeAutomations = await AutomationRule.countDocuments({
          clientCode,
          isActive: true,
        });
      } catch {
        // tenant DB might not be reachable — non-fatal
      }

      res.json({
        success: true,
        data: {
          clientCode,
          services: {
            whatsapp: whatsappToken ? "connected" : "not_configured",
            email: smtpHost || emailApiKey ? "configured" : "not_configured",
            googleMeet: googleRefreshToken ? "configured" : "not_configured",
          },
          activeAutomations,
          queueDepth,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * GET /api/saas/jobs/status/:jobId
 */
router.get("/jobs/status/:jobId", async (req: Request, res: Response) => {
  try {
    const { default: Job } = await import("../../model/queue/job.model.ts");
    const job = await Job.findById(req.params.jobId).lean();

    if (!job) {
      res.status(404).json({ success: false, message: "Job not found" });
      return;
    }

    const clientCode = (req as any).clientCode;
    if (job.data?.clientCode !== clientCode) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    res.json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError ?? null,
        runAt: job.runAt,
        completedAt: job.completedAt ?? null,
        failedAt: job.failedAt ?? null,
        createdAt: job.createdAt,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
