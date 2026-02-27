import { Router, type Request, type Response } from "express";

const router = Router();

/**
 * GET /api/saas/events/logs
 */
router.get("/events/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode;
    if (!clientCode) {
      res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized: Missing client context",
        });
      return;
    }

    const { page = 1, limit = 20, status, source } = req.query;

    const { getTenantConnection, getTenantModel } =
      await import("../../lib/connectionManager.ts");
    const { schemas } = await import("../../model/saas/tenant.schemas.ts");
    const tenantConn = await getTenantConnection(clientCode);
    const EventLog = getTenantModel<any>(
      tenantConn,
      "EventLog",
      schemas.eventLogs,
    );

    const query: any = { clientCode };
    if (status) query.status = status;
    if (source) query.source = source;

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      EventLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
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
 * GET /api/saas/callbacks/logs
 */
router.get("/callbacks/logs", async (req: Request, res: Response) => {
  try {
    const clientCode = (req as any).clientCode;
    if (!clientCode) {
      res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized: Missing client context",
        });
      return;
    }

    const { page = 1, limit = 20, status } = req.query;

    const { getTenantConnection, getTenantModel } =
      await import("../../lib/connectionManager.ts");
    const { schemas } = await import("../../model/saas/tenant.schemas.ts");
    const tenantConn = await getTenantConnection(clientCode);
    const CallbackLog = getTenantModel<any>(
      tenantConn,
      "CallbackLog",
      schemas.callbackLogs,
    );

    const query: any = { clientCode };
    if (status) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      CallbackLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
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
