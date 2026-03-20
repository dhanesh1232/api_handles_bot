/**
 * @module Routes/CRM/Sequence
 * @responsibility Multi-step communication flows (Drip Campaigns).
 *
 * **GOAL:** Allow manual and automated enrollment of leads into time-delayed message sequences.
 */
/**
 * @module Routes/CRM/Sequences
 * @responsibility Multi-step, time-delayed drip campaigns.
 *
 * **GOAL:** Manage the enrollment and tracking of leads within automated message sequences (e.g., 5-day welcome series).
 */
import { getCrmModels } from "@lib/tenant/crm.models";
import { Router } from "express";
import { enrollInSequence } from "@/services/saas/automation/sequenceEngine.service";
import { getLeadById } from "@/services/saas/crm/lead.service";

const sequenceRouter = Router();

/**
 * Manual Sequence Enrollment.
 *
 * **GOAL:** Explicitly subscribe a lead to a sequence, bypassing automatic trigger conditions.
 *
 * **DETAILED EXECUTION:**
 * 1. **Lead Validation**: Verifies the lead exists and is active for the current tenant.
 * 2. **Sequence Injection**: Invokes `enrollInSequence()` which creates the enrollment record and enqueues the first step in BullMQ/ErixWorkers.
 */
sequenceRouter.post("/enroll", async (req: any, res: any) => {
  const { clientCode } = req;
  const { leadId, ruleId, variables } = req.body;

  if (!leadId || !ruleId) {
    return res
      .status(400)
      .json({ success: false, message: "leadId and ruleId are required" });
  }

  try {
    const lead = await getLeadById(clientCode, leadId);
    if (!lead)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });

    const enrollmentId = await enrollInSequence(
      clientCode,
      ruleId,
      lead,
      variables || {},
    );

    res.json({ success: true, enrollmentId });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Unenroll a lead from a sequence
 */
sequenceRouter.delete("/unenroll/:enrollmentId", async (req: any, res: any) => {
  const { clientCode } = req;
  const { enrollmentId } = req.params;

  try {
    const { SequenceEnrollment } = await getCrmModels(clientCode);

    const enrollment = await SequenceEnrollment.findOne({
      _id: enrollmentId,
      clientCode,
    });
    if (!enrollment)
      return res
        .status(404)
        .json({ success: false, message: "Enrollment not found" });

    if (enrollment.status === "active") {
      enrollment.status = "exited";
      enrollment.exitReason = "manual_unenroll";
      await enrollment.save();
    }

    res.json({ success: true, message: "Unenrolled successfully" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * List active enrollments for a lead
 */
sequenceRouter.get("/lead/:leadId", async (req: any, res: any) => {
  const { clientCode } = req;
  const { leadId } = req.params;

  try {
    const { SequenceEnrollment } = await getCrmModels(clientCode);
    const enrollments = await SequenceEnrollment.find({
      leadId,
      clientCode,
      status: "active",
    });
    res.json({ success: true, enrollments });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default sequenceRouter;
