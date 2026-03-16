/**
 * notification.routes.ts
 *
 * Place at: src/routes/saas/crm/notification.routes.ts
 */

import { type Request, type Response, Router } from "express";

const router = Router();

// ─── List unread notifications ────────────────────────────────────────────────
router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const notifications = await req.sdk.notification.listUnread();
    res.json({ success: true, data: notifications });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Mark notification as dismissed ───────────────────────────────────────────
router.patch(
  "/notifications/:id/dismiss",
  async (req: Request, res: Response) => {
    try {
      const notif = await req.sdk.notification.dismiss(req.params.id as string);
      res.json({ success: true, data: notif });
    } catch (err: any) {
      res.status(err.message === "Notification not found" ? 404 : 500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// ─── Clear all notifications ────────────────────────────────────────────────
router.delete(
  "/notifications/clear-all",
  async (req: Request, res: Response) => {
    try {
      await req.sdk.notification.dismissAll();
      res.json({ success: true, message: "All notifications cleared" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ─── Retry Action Required Notification ────────────────────────────────────────
router.post("/notifications/:id/retry", async (req: Request, res: Response) => {
  try {
    const _result = await req.sdk.notification.retry(req.params.id as string);
    res.json({ success: true, message: "Action successfully retried" });
  } catch (err: any) {
    res.status(err.message.includes("not found") ? 404 : 400).json({
      success: false,
      message: `Retry failed: ${err.message}`,
    });
  }
});

export default router;
