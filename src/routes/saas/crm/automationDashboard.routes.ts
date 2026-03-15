/**
 * automationDashboard.routes.ts
 * Observability routes for the automation engine.
 * Place at: src/routes/saas/crm/automationDashboard.routes.ts
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import { type Request, type Response, Router } from "express";

const router = Router();

/**
 * GET /api/crm/automation/stats
 * Aggregated stats for automation health.
 */
router.get("/automation/stats", async (req: Request, res: Response) => {
  try {
    const { EventLog } = await getCrmModels(req.clientCode!);

    // Last 24 hours stats
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stats = await EventLog.aggregate([
      { $match: { clientCode: req.clientCode, createdAt: { $gte: dayAgo } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalRulesMatched: { $sum: "$rulesMatched" },
        },
      },
    ]);

    // Format stats for frontend
    const formattedStats = {
      received: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      totalRulesMatched: 0,
    };

    stats.forEach((s) => {
      if (s._id === "received") formattedStats.received = s.count;
      if (s._id === "processing") formattedStats.processing = s.count;
      if (s._id === "completed") formattedStats.completed = s.count;
      if (s._id === "failed") formattedStats.failed = s.count;
      formattedStats.totalRulesMatched += s.totalRulesMatched || 0;
    });

    res.json({ success: true, data: formattedStats });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/crm/automation/logs
 * List recent EventLog entries.
 */
router.get("/automation/logs", async (req: Request, res: Response) => {
  try {
    const { EventLog } = await getCrmModels(req.clientCode!);
    const { page = 1, limit = 50, trigger, status } = req.query;

    const query: any = { clientCode: req.clientCode };
    if (trigger) query.trigger = trigger;
    if (status) query.status = status;

    const logs = await EventLog.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await EventLog.countDocuments(query);

    res.json({
      success: true,
      data: logs,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/crm/automation/logs/:id/retry
 * Retry a failed event by re-emitting it.
 */
router.post(
  "/automation/logs/:id/retry",
  async (req: Request, res: Response) => {
    try {
      const { EventLog } = await getCrmModels(req.clientCode!);
      const { EventBus } = await import(
        "@/services/saas/event/eventBus.service"
      );

      const log = await EventLog.findOne({
        _id: req.params.id,
        clientCode: req.clientCode,
      }).lean();
      if (!log) {
        return res
          .status(404)
          .json({ success: false, message: "Event log not found" });
      }

      // Re-emit using EventBus
      await EventBus.emit(
        req.clientCode!,
        log.trigger,
        {
          phone: log.phone,
          email: log.email,
          data: log.payload,
        },
        { idempotencyKey: `retry-${log._id}-${Date.now()}` },
      );

      res.json({ success: true, message: "Retry triggered successfully" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

export default router;
