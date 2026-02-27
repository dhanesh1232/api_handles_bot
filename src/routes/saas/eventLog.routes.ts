import { Router, type Request, type Response } from "express";
import { CallbackLog } from "../../model/saas/event/callbackLog.model.ts";
import { EventLog } from "../../model/saas/event/eventLog.model.ts";

const router = Router();

/**
 * GET /api/saas/events/logs
 * Returns EventLog records for this client
 * Query: trigger, status, phone, startDate, endDate, page, limit
 */
router.get("/events/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
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
 * GET /api/saas/callbacks/logs
 * Returns CallbackLog records for this client
 * Query: status, page, limit, startDate, endDate
 */
router.get("/callbacks/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode as string;
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
