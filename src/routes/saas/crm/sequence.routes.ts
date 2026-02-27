import { Router } from "express";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";
import { enrollInSequence } from "../../../services/saas/automation/sequenceEngine.service.ts";
import { getLeadById } from "../../../services/saas/crm/lead.service.ts";

const sequenceRouter = Router();

/**
 * Enroll a lead into a sequence manually
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
    const tenantConn = await getTenantConnection(clientCode);
    const SequenceEnrollment = getTenantModel<any>(
      tenantConn,
      "SequenceEnrollment",
      schemas.sequenceEnrollments,
    );

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
    const tenantConn = await getTenantConnection(clientCode);
    const SequenceEnrollment = getTenantModel<any>(
      tenantConn,
      "SequenceEnrollment",
      schemas.sequenceEnrollments,
    );

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
