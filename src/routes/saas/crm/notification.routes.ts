/**
 * notification.routes.ts
 *
 * Place at: src/routes/saas/crm/notification.routes.ts
 */

import { Router, type Request, type Response } from "express";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { executeAction } from "../../../services/saas/crm/automation.service.ts";

const router = Router();

// ─── List unread notifications ────────────────────────────────────────────────
router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const { Notification } = await getCrmModels(req.clientCode!);
    const notifications = await Notification.find({
      clientCode: req.clientCode,
      status: "unread",
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("actionData.leadId", "firstName lastName phone email _id");

    res.json({ success: true, data: notifications });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ─── Mark notification as dismissed ───────────────────────────────────────────
router.patch(
  "/notifications/:id/dismiss",
  async (req: Request, res: Response) => {
    try {
      const { Notification } = await getCrmModels(req.clientCode!);
      const notif = await Notification.findOneAndUpdate(
        { _id: req.params.id, clientCode: req.clientCode },
        { $set: { status: "dismissed" } },
        { new: true },
      );

      if (!notif) {
        res
          .status(404)
          .json({ success: false, message: "Notification not found" });
        return;
      }

      res.json({ success: true, data: notif });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

// ─── Clear all unread notifications ──────────────────────────────────────────
router.delete(
  "/notifications/clear-all",
  async (req: Request, res: Response) => {
    try {
      const { Notification } = await getCrmModels(req.clientCode!);
      await Notification.updateMany(
        { clientCode: req.clientCode, status: "unread" },
        { $set: { status: "dismissed" } },
      );

      res.json({ success: true, message: "All notifications cleared" });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

// ─── Retry Action Required Notification ────────────────────────────────────────
router.post("/notifications/:id/retry", async (req: Request, res: Response) => {
  try {
    const { clientCode } = req;
    const { Notification, Lead } = await getCrmModels(clientCode!);

    const notif = await Notification.findOne({
      _id: req.params.id,
      clientCode,
      status: "unread",
    });

    if (!notif) {
      res.status(404).json({
        success: false,
        message: "Notification not found or already resolved",
      });
      return;
    }

    const { actionConfig, leadId, contextSnapshot } = notif.actionData || {};

    if (!actionConfig || !leadId) {
      res.status(400).json({
        success: false,
        message:
          "Missing action configuration or Lead ID in notification payload",
      });
      return;
    }

    const lead = await Lead.findOne({ _id: leadId, clientCode });
    if (!lead) {
      res
        .status(404)
        .json({ success: false, message: "Lead no longer exists" });
      return;
    }

    // Auto-inject missing legacy context for old failed notifications
    const safeVariables = (contextSnapshot as any) || {};
    if (!safeVariables.appointmentId) {
      // Let's check if the trigger requires it
      const triggers = [
        "appointment_confirmed",
        "appointment_reminder",
        "meeting_created",
      ];
      if (
        triggers.includes(notif.actionData.trigger || "appointment_confirmed")
      ) {
        const { getTenantConnection } =
          await import("../../../lib/connectionManager.ts");
        const tenantConn = await getTenantConnection(clientCode!);

        // Find most recent appointment for this lead (via phone)
        const latestAppts = await tenantConn
          .collection("appointments")
          .find({ patientPhone: lead.phone })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();

        if (latestAppts.length > 0) {
          const latestAppt = latestAppts[0];
          safeVariables.appointmentId = latestAppt._id.toString();
          if (latestAppt.doctorId) {
            safeVariables.doctorId = latestAppt.doctorId.toString();
          }
        }
      }
    }

    // Try executing the action again
    try {
      await executeAction(
        clientCode!,
        actionConfig as any,
        lead as unknown as ILead,
        { variables: safeVariables } as any,
      );

      // If it succeeds without throwing, mark as resolved
      notif.status = "resolved";
      await notif.save();

      res.json({ success: true, message: "Action successfully retried" });
    } catch (actErr: any) {
      // If it fails again, respond with failure so client can show error toast
      res.status(400).json({
        success: false,
        message: `Retry failed: ${actErr.message}`,
      });
    }
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
