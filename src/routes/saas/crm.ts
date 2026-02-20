import type { Request, Response } from "express";
import express, { Router } from "express";
import { validateClientKey } from "../../middleware/saasAuth.js";
import Pipeline from "../../model/saas/crm/pipeline.model.ts";
import PipelineStage from "../../model/saas/crm/pipelineStage.model.ts";
import { updateLeadStage, upsertLead } from "../../services/saas/lead/lead.services.ts";

interface SaasRequest extends Request {
  clientCode?: string;
}

const router: Router = express.Router();

// Middleware to apply saasAuth to all CRM routes
router.use(validateClientKey);

// --- Pipelines ---
router.get("/pipelines", async (req: SaasRequest, res: Response) => {
  try {
    const pipelines = await Pipeline.find({ clientCode: req.clientCode }).sort({ order: 1 });
    res.json({ success: true, data: pipelines });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/pipelines", async (req: SaasRequest, res: Response) => {
  try {
    const pipeline = await Pipeline.create({ ...req.body, clientCode: req.clientCode });
    res.json({ success: true, data: pipeline });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Stages ---
router.get("/stages", async (req: SaasRequest, res: Response) => {
  try {
    const { pipelineId } = req.query;
    const filter: any = { clientCode: req.clientCode };
    if (pipelineId) filter.pipelineId = pipelineId;
    
    const stages = await PipelineStage.find(filter).sort({ order: 1 });
    res.json({ success: true, data: stages });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/stages", async (req: SaasRequest, res: Response) => {
  try {
    const stage = await PipelineStage.create({ ...req.body, clientCode: req.clientCode });
    res.json({ success: true, data: stage });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/stages/reorder", async (req: SaasRequest, res: Response) => {
  try {
    const { stages } = req.body; // Array of { _id, order }
    const promises = stages.map((s: any) => 
      PipelineStage.findOneAndUpdate(
        { _id: s._id, clientCode: req.clientCode },
        { order: s.order }
      )
    );
    await Promise.all(promises);
    res.json({ success: true, message: "Stages reordered" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Leads ---
router.post("/leads/upsert", async (req: SaasRequest, res: Response) => {
  try {
    const { leadData, moduleInfo } = req.body;
    const lead = await upsertLead(req.clientCode!, leadData, moduleInfo);
    res.json({ success: true, data: lead });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/leads/:id/stage", async (req: SaasRequest, res: Response) => {
  try {
    const { stageId } = req.body;
    const lead = await updateLeadStage(req.clientCode!, req.params.id as string, stageId);
    res.json({ success: true, data: lead });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
