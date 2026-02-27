import { Router, type Request, type Response } from "express";
import * as scoringService from "../../../services/saas/crm/scoring.service.ts";

const router = Router();

/**
 * GET /api/crm/scoring
 * Get scoring configuration
 */
router.get("/scoring", async (req: Request, res: Response) => {
  try {
    const config = await scoringService.getScoringConfig(req.clientCode!);
    res.json({ success: true, data: config });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/scoring
 * Update scoring configuration
 */
router.patch("/scoring", async (req: Request, res: Response) => {
  try {
    const {
      rules,
      hotThreshold = 70,
      coldThreshold = 20,
      recalculateOnTriggers = [],
    } = req.body;
    if (!rules || !Array.isArray(rules)) {
      res
        .status(400)
        .json({ success: false, message: "rules array is required" });
      return;
    }

    const config = await scoringService.updateScoringConfig(
      req.clientCode!,
      rules,
      hotThreshold,
      coldThreshold,
      recalculateOnTriggers,
    );

    res.json({ success: true, data: config });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/scoring/:leadId/recalculate
 * Immediately recalculate score for one lead
 */
router.post(
  "/scoring/:leadId/recalculate",
  async (req: Request, res: Response) => {
    try {
      const result = await scoringService.recalculateLeadScore(
        req.clientCode!,
        req.params.leadId as string,
      );
      if (!result) {
        res.status(404).json({ success: false, message: "Lead not found" });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

export default router;
