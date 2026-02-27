import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { dbConnect } from "../../lib/config.ts";
import { renderView } from "../../lib/renderView.ts";
import { validateClientKey } from "../../middleware/saasAuth.ts";

const router = Router();

const VERSION: string = process.env.npm_package_version ?? "unknown";

/** Syntax-highlight a JSON object into HTML spans (server-side). */
function highlight(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="n">$1</span>')
    .replace(/: (true|false)/g, ': <span class="b">$1</span>')
    .replace(/: null/g, ': <span class="null">null</span>');
}

/**
 * GET /api/saas/health
 * Public — no auth required.
 * • Browser (Accept: text/html) → premium live health dashboard (src/views/health.html)
 * • API / curl / load balancer  → clean JSON envelope
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
    queueDepth = await Job.countDocuments({
      status: { $in: ["pending", "processing"] },
    });
  } catch {
    // Non-fatal — queue depth is best-effort
  }

  const payload = {
    status: "ok",
    version: VERSION,
    env: process.env.NODE_ENV ?? "development",
    uptime: Math.floor(process.uptime()),
    db: dbStatus,
    queueDepth,
    timestamp: new Date().toISOString(),
  };

  // Content negotiation — HTML for browsers, JSON for everything else
  const acceptsHtml =
    req.headers.accept?.includes("text/html") &&
    !req.headers.accept?.includes("application/json");

  if (!acceptsHtml) {
    return res.json({ success: true, data: payload });
  }

  const isOk = dbStatus === "connected";
  const dbBadge = isOk ? "ok" : "error";
  const statusText = isOk ? "Healthy" : "Degraded";
  const bootTs = Date.now() - payload.uptime * 1000;
  const envelope = { success: true, data: payload };

  // Double stringify to get a valid JS string literal of the pretty JSON
  const rawJson = JSON.stringify(envelope, null, 2);
  const escapedJson = JSON.stringify(rawJson).replace(/<\/script/gi, "<\\/script");

  const html = renderView("health.html", {
    VERSION: payload.version,
    ENV: payload.env,
    DB_BADGE: dbBadge,
    STATUS_TEXT: statusText,
    STATUS_MESSAGE: isOk ? "All systems operational" : "Database unreachable",
    STATUS_UPPER: payload.status.toUpperCase(),
    STATUS_COLOR_CLASS: isOk ? "green" : "red",
    DB_STATUS: dbStatus,
    DB_COLOR_CLASS: isOk ? "green" : "red",
    QUEUE_DEPTH: String(queueDepth),
    QUEUE_COLOR_CLASS: queueDepth > 50 ? "yellow" : "",
    BOOT_TS: String(bootTs),
    JSON_HIGHLIGHTED: highlight(envelope),
    JSON_RAW_ESCAPED: escapedJson,
    NONCE: res.locals.cspNonce as string,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
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
