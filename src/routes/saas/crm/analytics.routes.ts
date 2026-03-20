/**
 * @module Routes/CRM/Analytics
 * @responsibility Business intelligence and KPI reporting for the CRM layer.
 *
 * **GOAL:** Provide aggregated insights into lead conversion, team performance, and communication volume across various time ranges.
 */

/**
 * @module Routes/CRM/Analytics
 * @responsibility KPI reporting and funnel performance visualization.
 *
 * **GOAL:** Aggregate tenant data into actionable insights, including conversion rates, lead aging, and individual agent performance.
 *
 * **DETAILED EXECUTION:**
 * 1. **Aggregation Engine**: Utilizes complex MongoDB pipelines to compute stats across large lead sets.
 * 2. **Performance Auditing**: Tracks time-in-stage to identify bottlenecks in the sales funnel.
 */
import { type Request, type Response, Router } from "express";
import * as analyticsService from "@/services/saas/crm/analytics.service";

const router = Router();

type Range = AnalyticsRange;

/**
 * GET /api/crm/analytics/whatsapp
 * WhatsApp volume and delivery analytics.
 * Query: range = 24h | 7d | 30d | 60d | 90d | 365d
 */
router.get("/analytics/whatsapp", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as any) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getWhatsAppAnalytics(
      req.clientCode!,
      range,
      from,
      to,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/overview
 * KPIs: total leads, pipeline value, won revenue, avg score, conversion rate.
 * Query: range = 24h | 7d | 30d | 60d | 90d | 365d
 */
router.get("/analytics/overview", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getOverview(
      req.clientCode!,
      range,
      from,
      to,
    );
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
 * Query: range = 24h | 7d | 30d | 60d | 90d | 365d
 */
router.get("/analytics/sources", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getSourceBreakdown(
      req.clientCode!,
      range,
      from,
      to,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/team
 * Team leaderboard: won deals, revenue, activity count, conversion rate per member.
 * Query: range = 24h | 7d | 30d | 60d | 90d | 365d
 */
router.get("/analytics/team", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getTeamLeaderboard(
      req.clientCode!,
      range,
      from,
      to,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/heatmap
 * Daily activity counts by type. For activity calendar.
 * Query: range = 24h | 7d | 30d | 60d | 90d | 365d
 */
router.get("/analytics/heatmap", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getActivityHeatmap(
      req.clientCode!,
      range,
      from,
      to,
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

/**
 * Tiered Growth Report.
 *
 * **GOAL:** Retrieve structured analytics categorized by business sophistication (Basic, Medium, Advanced).
 *
 * **DETAILED EXECUTION:**
 * 1. **Multi-Dimension Analysis**: Aggregates revenue, conversion, and activity velocity into a single tiered response.
 */
router.get("/analytics/tiered", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to, pipelineId } = req.query as any;
    const data = await analyticsService.getTieredReport(
      req.clientCode!,
      range,
      pipelineId,
      from,
      to,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/analytics/summary
 * Consolidated analytics including CRM overview and WhatsApp.
 */
router.get("/analytics/summary", async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as Range) ?? "30d";
    const { from, to } = req.query as any;
    const data = await analyticsService.getDashboardSummary(
      req.clientCode!,
      range,
      from,
      to,
    );
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
