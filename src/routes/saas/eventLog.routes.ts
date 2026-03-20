import { getCrmModels } from "@lib/tenant/crm.models";
import { type Request, type Response, Router } from "express";

const router = Router();

/**
 * Event Log Audit Trail.
 *
 * **GOAL:** Provide a searchable, paginated history of all automation triggers and execution outcomes for a specific tenant.
 *
 * **DETAILED EXECUTION:**
 * 1. **Tenant Model Binding**: Dynamically resolves the `EventLog` model for the current `clientCode`.
 * 2. **Multi-Faceted Filtering**: Builds a query object supporting `trigger` type, execution `status`, recipient `phone`, and a `createdAt` date range.
 * 3. **Data Retrieval**: Executes parallel `find` and `countDocuments` operations to provide full pagination metadata.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Invalid Date Formats: Standard `new Date()` wrapping for `startDate`/`endDate`; relies on global error handler if parsing fails catastrophically.
 */
router.get("/events/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
    const { EventLog } = await getCrmModels(clientCode);
    const {
      page = 1,
      limit = 25,
      trigger,
      status,
      phone,
      startDate,
      endDate,
    } = req.query;

    const query: Record<string, any> = { clientCode };
    if (trigger) query.trigger = trigger;
    if (status) query.status = status;
    if (phone) query.phone = phone;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      EventLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/saas/events/logs/:logId
 * Single event log detail
 */
router.get("/events/logs/:logId", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
    const { EventLog } = await getCrmModels(clientCode);
    const log = await EventLog.findOne({
      _id: req.params.logId,
      clientCode,
    }).lean();
    if (!log)
      return res
        .status(404)
        .json({ success: false, message: "Event log not found" });
    res.json({ success: true, data: log });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/saas/events/stats
 * Summary stats for this client
 * Query: startDate, endDate
 */
router.get("/events/stats", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
    const { EventLog } = await getCrmModels(clientCode);
    const { startDate, endDate } = req.query;

    const dateFilter: Record<string, any> = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate as string);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate as string);
    }

    const [byTrigger, byStatus, totalCount] = await Promise.all([
      EventLog.aggregate([
        { $match: { clientCode, ...dateFilter } },
        {
          $group: {
            _id: "$trigger",
            count: { $sum: 1 },
            successCount: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
          },
        },
        {
          $project: {
            trigger: "$_id",
            count: 1,
            successRate: {
              $cond: [
                { $gt: ["$count", 0] },
                { $divide: ["$successCount", "$count"] },
                0,
              ],
            },
            _id: 0,
          },
        },
        { $sort: { count: -1 } },
      ]),
      EventLog.aggregate([
        { $match: { clientCode, ...dateFilter } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $project: { status: "$_id", count: 1, _id: 0 } },
      ]),
      EventLog.countDocuments({ clientCode, ...dateFilter }),
    ]);

    res.json({
      success: true,
      data: {
        totalEvents: totalCount,
        byTrigger,
        byStatus,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * External Callback Audit Trail.
 *
 * **GOAL:** Track incoming webhook payloads and status updates from third-party providers (e.g., Meta/WhatsApp, SMTP providers).
 *
 * **DETAILED EXECUTION:**
 * 1. **Inbound Resolution**: Queries the `CallbackLog` collection to show what the system received from external vendors.
 * 2. **Chronological Sorting**: Enforces `{ createdAt: -1 }` to ensure recent deliveries are prioritized.
 */
router.get("/callbacks/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
    const { CallbackLog } = await getCrmModels(clientCode);
    const { page = 1, limit = 25, status, startDate, endDate } = req.query;

    const query: Record<string, any> = { clientCode };
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      CallbackLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      CallbackLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
