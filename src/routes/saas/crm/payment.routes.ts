import { type Request, type Response, Router } from "express";
import { onPaymentCaptured } from "../../../services/saas/crm/crmHooks.ts";

const router = Router();

/**
 * POST /api/crm/payments/capture
 * Notifies the CRM of a successful payment.
 * Links to Lead via appointmentId, phone, or email.
 */
router.post("/payments/capture", async (req: Request, res: Response) => {
  try {
    const { phone, email, appointmentId, orderId, amount, currency } = req.body;

    if (!amount) {
      res.status(400).json({ success: false, message: "amount is required" });
      return;
    }

    await onPaymentCaptured(req.clientCode!, {
      phone,
      email,
      appointmentId,
      orderId,
      amount,
      currency,
    });

    res.json({ success: true, message: "Payment tracked in CRM" });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
