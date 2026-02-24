/**
 * analytics.routes.ts
 * All CRM analytics endpoints.
 * Place at: src/routes/saas/crm/analytics.routes.ts
 */

import { Router, type Request, type Response } from "express";
import * as analyticsService from "../../../services/saas/crm/analytics.service.ts";

const router = Router();

type Range = "7d" | "30d" | "90d" | "365d";

/**
 * GET /api/crm/analytics/overview
 * KPIs: total leads, pipeline value, won revenue, avg score, conversion rate.
 * Query: range = 7d | 30d | 90d | 365d
 */
router.get("/analytics/overview", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const data = await analyticsService.getOverview(req.clientCode!, range);
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/funnel
 * Stage-by-stage lead counts and conversion percentages.
 * Query: pipelineId (required)
 */
router.get("/analytics/funnel", async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.query as Record<string, string>;
    if (!pipelineId) {
      res
        .status(400)
        .json({ success: false, message: "pipelineId is required" });
      return;
    }
    const data = await analyticsService.getFunnelData(
      req.clientCode!,
      pipelineId,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/forecast
 * Revenue forecast: deal value × stage probability.
 * Query: pipelineId? (optional — all pipelines if omitted)
 */
router.get("/analytics/forecast", async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.query as Record<string, string>;
    const data = await analyticsService.getRevenueForecast(
      req.clientCode!,
      pipelineId,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/sources
 * Lead source breakdown: count, conversion rate, total value per source.
 * Query: range = 7d | 30d | 90d | 365d
 */
router.get("/analytics/sources", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const data = await analyticsService.getSourceBreakdown(
      req.clientCode!,
      range,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/team
 * Team leaderboard: won deals, revenue, activity count, conversion rate per member.
 * Query: range = 7d | 30d | 90d | 365d
 */
router.get("/analytics/team", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const data = await analyticsService.getTeamLeaderboard(
      req.clientCode!,
      range,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/heatmap
 * Daily activity counts by type. For activity calendar.
 * Query: range = 30d | 90d
 */
router.get("/analytics/heatmap", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as "30d" | "90d") ?? "30d";
    const data = await analyticsService.getActivityHeatmap(
      req.clientCode!,
      range,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/scores
 * Score distribution: how many leads in each score bucket (0-19, 20-39, etc.)
 */
router.get("/analytics/scores", async (req: Request, res: Response) => {
  try {
    const data = await analyticsService.getScoreDistribution(req.clientCode!);
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/stage-time
 * Avg time leads spend in each stage. Helps find bottlenecks.
 * Query: pipelineId (required)
 */
router.get("/analytics/stage-time", async (req: Request, res: Response) => {
  try {
    const { pipelineId } = req.query as Record<string, string>;
    if (!pipelineId) {
      res
        .status(400)
        .json({ success: false, message: "pipelineId is required" });
      return;
    }
    const data = await analyticsService.getAvgTimeInStage(
      req.clientCode!,
      pipelineId,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
