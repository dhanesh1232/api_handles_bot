/**
 * analyticsService.ts
 * CRM analytics: funnel, forecast, sources, team leaderboard, overview KPIs.
 *
 * All queries run against the client's own tenant DB via getCrmModels().
 */

import { getCrmModels } from "@lib/tenant/crm.models";
import mongoose from "mongoose";

const getQueryDateRange = (range?: AnalyticsRange, from?: any, to?: any) => {
  if (from || to) {
    return {
      since: from ? new Date(from) : new Date(0),
      until: to ? new Date(to) : new Date(),
    };
  }

  const ms: Record<string, number> = {
    "24h": 1,
    "7d": 7,
    "30d": 30,
    "60d": 60,
    "90d": 90,
    "365d": 365,
  };
  const days = ms[range ?? "30d"] ?? 30;
  return {
    since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    until: new Date(),
  };
};

// ─── 0. WhatsApp Specialized Analytics ───────────────────────────────────────

/**
 * Aggregates WhatsApp messaging metrics for a specific time range.
 *
 * **WORKING PROCESS:**
 * 1. Date Range: Resolves the filter range into concrete `since` and `until` Date objects.
 * 2. Message Aggregation: Groups outbound messages by status (sent, delivered, read, failed) within the timeframe.
 * 3. Conversation Tracking: Counts active WhatsApp conversations that had activity during the range.
 * 4. Rate Calculation: Computes delivery and failure percentages to measure communication health.
 *
 * **EDGE CASES:**
 * - Zero Messages: Correctly handles divisions by zero, returning 0% rates if no messages exist.
 * - Missing Status: Uses default values (0) if some statuses (like "failed") are not present in the aggregation result.
 *
 * @param clientCode - Tenant identifier.
 * @param range - Predefined range (e.g., "7d", "30d").
 * @param from - Custom start date.
 * @param to - Custom end date.
 */
export const getWhatsAppAnalytics = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const { Message, Conversation } = await getCrmModels(clientCode);
  const { since, until } = getQueryDateRange(range, from, to);

  const [messageStats, conversationStats] = await Promise.all([
    Message.aggregate([
      {
        $match: {
          direction: "outbound",
          createdAt: { $gte: since, $lte: until },
          messageType: { $ne: "reaction" },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
    Conversation.countDocuments({
      channel: "whatsapp",
      lastMessageAt: { $gte: since, $lte: until },
    }),
  ]);

  const statsMap = new Map(messageStats.map((r: any) => [r._id, r.count]));

  const sent = statsMap.get("sent") ?? 0;
  const delivered = statsMap.get("delivered") ?? 0;
  const read = statsMap.get("read") ?? 0;
  const failed = statsMap.get("failed") ?? 0;
  const totalOutbound = sent + delivered + read + failed;

  return {
    range,
    activeConversations: conversationStats,
    messages: {
      totalOutbound,
      sent,
      delivered,
      read,
      failed,
      deliveryRate:
        totalOutbound > 0
          ? Math.round(((delivered + read) / totalOutbound) * 100)
          : 0,
      failureRate:
        totalOutbound > 0 ? Math.round((failed / totalOutbound) * 100) : 0,
    },
  };
};

// ─── 1. Overview KPIs ─────────────────────────────────────────────────────────

/**
 * Calculates high-level CRM KPIs including total leads, won revenue, and activity volume.
 *
 * **WORKING PROCESS:**
 * 1. Multi-Dimensional Scan: Runs massive parallel aggregations across `Lead` and `LeadActivity` collections.
 * 2. Revenue Summation: Aggregates `dealValue` for all leads with "won" status within the period.
 * 3. Global Perspective: Also fetches absolute totals (all time) to provide context for the period-specific metrics.
 * 4. Score Averaging: Computes the mean lead score across the entire database to track lead quality.
 *
 * **EDGE CASES:**
 * - No Historical Data: Returns a zeroed object if the tenant is fresh.
 * - Null Lead Scores: Uses `$avg` which ignores nulls, ensuring inaccurate zeros don't skew the average.
 *
 * @param clientCode - Tenant identifier.
 * @param range - Analytics timeframe.
 */
export const getOverview = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { since, until } = getQueryDateRange(range, from, to);

  const [totals, periodLeads, wonDeals, activities, leadsToday] =
    await Promise.all([
      Lead.aggregate([
        { $match: { clientCode, isArchived: false } },
        {
          $group: {
            _id: null,
            totalLeads: { $sum: 1 },
            totalPipeline: { $sum: { $ifNull: ["$dealValue", 0] } },
            totalWon: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "won"] },
                  { $ifNull: ["$dealValue", 0] },
                  0,
                ],
              },
            },
            avgScore: { $avg: "$score.total" },
            openLeads: {
              $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] },
            },
          },
        },
      ]),
      Lead.countDocuments({
        clientCode,
        isArchived: false,
        createdAt: { $gte: since, $lte: until },
      }),
      Lead.aggregate([
        {
          $match: {
            clientCode,
            status: "won",
            convertedAt: { $gte: since, $lte: until },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ["$dealValue", 0] } },
          },
        },
      ]),
      LeadActivity.countDocuments({
        clientCode,
        createdAt: { $gte: since, $lte: until },
      }),
      Lead.countDocuments({
        clientCode,
        isArchived: false,
        createdAt: { $gte: today },
      }),
    ]);

  const t = totals[0] ?? {};
  const won = wonDeals[0] ?? { count: 0, revenue: 0 };

  return {
    totalLeads: (t as any).totalLeads ?? 0,
    openLeads: (t as any).openLeads ?? 0,
    newLeadsInPeriod: periodLeads,
    leadsToday,
    totalPipelineValue: (t as any).totalPipeline ?? 0,
    wonDealsInPeriod: (won as any).count,
    revenueInPeriod: (won as any).revenue,
    avgLeadScore: Math.round((t as any).avgScore ?? 0),
    activitiesInPeriod: activities,
    conversionRate:
      (t as any).totalLeads > 0
        ? Math.round(((won as any).count / (t as any).totalLeads) * 100)
        : 0,
  };
};

// ─── 2. Pipeline funnel — conversion % per stage ──────────────────────────────

/**
 * Generates conversion data for a specific pipeline funnel.
 *
 * **WORKING PROCESS:**
 * 1. Stage Inventory: Fetches all stages for the pipeline sorted by their defined order.
 * 2. Lead Distribution: Aggregates leads currently standing in each stage, summing their deal values.
 * 3. Funnel Calculation: Identifies the stage with the highest lead count as the "top of funnel" (usually first stage).
 * 4. Conversion %: Calculates each stage's percentage relative to the top count to visualize drop-offs.
 *
 * **EDGE CASES:**
 * - Empty Pipeline: Returns stages with zero counts if no leads are assigned to the pipeline.
 * - Non-Linear Funnel: Logic assumes the stage with max count is the baseline, supporting flexible lead flows.
 *
 * @param clientCode - Tenant identifier.
 * @param pipelineId - Target pipeline to analyze.
 */
export const getFunnelData = async (clientCode: string, pipelineId: string) => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);

  const stages = await PipelineStage.find({
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  })
    .sort({ order: 1 })
    .lean();

  const agg = await Lead.aggregate([
    {
      $match: {
        clientCode,
        pipelineId: new mongoose.Types.ObjectId(pipelineId),
        isArchived: false,
      },
    },
    {
      $group: {
        _id: "$stageId",
        count: { $sum: 1 },
        totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
      },
    },
  ]);

  const statsMap = new Map(agg.map((r: any) => [r._id.toString(), r]));
  const topCount = agg.reduce(
    (max: number, r: any) => Math.max(max, r.count),
    0,
  );

  return stages.map((stage: any, idx: number) => {
    const stats: any = statsMap.get(stage._id.toString());
    const count = stats?.count ?? 0;
    return {
      stageId: stage._id.toString(),
      stageName: stage.name,
      stageColor: stage.color,
      order: idx,
      count,
      totalValue: stats?.totalValue ?? 0,
      conversionPct: topCount > 0 ? Math.round((count / topCount) * 100) : 0,
      isWon: stage.isWon,
      isLost: stage.isLost,
    };
  });
};

// ─── 3. Revenue forecast ──────────────────────────────────────────────────────

/**
 * Produces a weighted revenue forecast based on pipeline probabilities.
 *
 * **WORKING PROCESS:**
 * 1. Probability Retrieval: Fetches the percentage probability (0-100) defined for each pipeline stage.
 * 2. Pipeline Snapshot: Aggregates total `dealValue` for open leads grouped by their current stage.
 * 3. Weighted Calculation: Multiplies the raw total value of each stage by its conversion probability.
 * 4. Grand Totaling: Sums the expected revenue from all stages to provide a "realistic" sales forecast.
 *
 * **EDGE CASES:**
 * - Missing Probabilities: Stages with no probability default to 0 revenue impact.
 * - Filter Scope: Can be scoped to a specific pipeline or the entire tenant portfolio.
 *
 * @param clientCode - Tenant identifier.
 * @param pipelineId - Optional pipeline filter.
 */
export const getRevenueForecast = async (
  clientCode: string,
  pipelineId?: string,
) => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);

  const leadMatch: Record<string, unknown> = {
    clientCode,
    status: "open",
    isArchived: false,
  };
  const stageQuery: Record<string, unknown> = { clientCode, isLost: false };
  if (pipelineId) {
    leadMatch.pipelineId = new mongoose.Types.ObjectId(pipelineId);
    stageQuery.pipelineId = new mongoose.Types.ObjectId(pipelineId);
  }

  const [stages, agg] = await Promise.all([
    PipelineStage.find(stageQuery).sort({ order: 1 }).lean(),
    Lead.aggregate([
      { $match: leadMatch },
      {
        $group: {
          _id: "$stageId",
          totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const statsMap = new Map(agg.map((r: any) => [r._id.toString(), r]));

  const rows = stages.map((stage: any) => {
    const stats: any = statsMap.get(stage._id.toString());
    const totalValue = stats?.totalValue ?? 0;
    return {
      stageId: stage._id.toString(),
      stageName: stage.name,
      stageColor: stage.color,
      probability: stage.probability,
      totalValue,
      expectedRevenue: Math.round((totalValue * stage.probability) / 100),
      leadCount: stats?.count ?? 0,
    };
  });

  const grandTotal = rows.reduce((s, r) => s + r.expectedRevenue, 0);
  const totalPipeline = rows.reduce((s, r) => s + r.totalValue, 0);

  return { rows, grandTotal, totalPipeline };
};

// ─── 4. Lead sources breakdown ────────────────────────────────────────────────

export const getSourceBreakdown = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const { Lead } = await getCrmModels(clientCode);
  const { since, until } = getQueryDateRange(range, from, to);

  const agg = await Lead.aggregate([
    {
      $match: {
        clientCode,
        isArchived: false,
        createdAt: { $gte: since, $lte: until },
      },
    },
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 },
        totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
        wonCount: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const total = agg.reduce((s: number, r: any) => s + r.count, 0);

  return agg.map((r: any) => ({
    source: r._id,
    count: r.count,
    percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    totalValue: r.totalValue,
    wonCount: r.wonCount,
    conversionRate: r.count > 0 ? Math.round((r.wonCount / r.count) * 100) : 0,
  }));
};

// ─── 5. Team leaderboard ──────────────────────────────────────────────────────

export const getTeamLeaderboard = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);
  const { since, until } = getQueryDateRange(range, from, to);

  const [dealStats, activityStats] = await Promise.all([
    Lead.aggregate([
      {
        $match: {
          clientCode,
          isArchived: false,
          assignedTo: { $ne: null },
          updatedAt: { $gte: since, $lte: until },
        },
      },
      {
        $group: {
          _id: "$assignedTo",
          totalLeads: { $sum: 1 },
          wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
          wonValue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "won"] },
                { $ifNull: ["$dealValue", 0] },
                0,
              ],
            },
          },
          avgScore: { $avg: "$score.total" },
        },
      },
    ]),
    LeadActivity.aggregate([
      {
        $match: {
          clientCode,
          performedBy: { $ne: "system" },
          createdAt: { $gte: since, $lte: until },
        },
      },
      { $group: { _id: "$performedBy", activityCount: { $sum: 1 } } },
    ]),
  ]);

  const activityMap = new Map(
    activityStats.map((r: any) => [r._id, r.activityCount]),
  );

  return dealStats
    .map((r: any) => ({
      name: r._id,
      totalLeads: r.totalLeads,
      wonLeads: r.wonLeads,
      wonValue: r.wonValue,
      avgScore: Math.round(r.avgScore ?? 0),
      activityCount: activityMap.get(r._id) ?? 0,
      conversionRate:
        r.totalLeads > 0 ? Math.round((r.wonLeads / r.totalLeads) * 100) : 0,
    }))
    .sort((a: any, b: any) => b.wonValue - a.wonValue);
};

// ─── 6. Activity heatmap ──────────────────────────────────────────────────────

export const getActivityHeatmap = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const { LeadActivity } = await getCrmModels(clientCode);
  const { since, until } = getQueryDateRange(range, from, to);

  const agg = await LeadActivity.aggregate([
    { $match: { clientCode, createdAt: { $gte: since, $lte: until } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          type: "$type",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  return agg.map((r: any) => ({
    date: r._id.date,
    type: r._id.type,
    count: r.count,
  }));
};

// ─── 7. Avg time in stage ─────────────────────────────────────────────────────

export const getAvgTimeInStage = async (
  clientCode: string,
  pipelineId: string,
) => {
  const { LeadActivity, PipelineStage } = await getCrmModels(clientCode);

  const changes = await LeadActivity.aggregate([
    {
      $match: {
        clientCode,
        type: "stage_change",
        "metadata.toStageId": { $exists: true },
      },
    },
    {
      $group: {
        _id: "$metadata.toStageId",
        count: { $sum: 1 },
        avgCount: { $avg: 1 },
      },
    },
  ]);

  const stages = await PipelineStage.find({
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  })
    .sort({ order: 1 })
    .lean();

  const statsMap = new Map(changes.map((r: any) => [r._id, r]));

  return stages.map((stage: any) => ({
    stageId: stage._id.toString(),
    stageName: stage.name,
    stageColor: stage.color,
    moveCount: (statsMap.get(stage._id.toString()) as any)?.count ?? 0,
  }));
};

// ─── 7b. Pipeline Velocity (Time spent per stage) ───────────────────────────

export const getPipelineVelocity = async (
  clientCode: string,
  pipelineId: string,
) => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);

  const agg = await Lead.aggregate([
    {
      $match: {
        clientCode,
        pipelineId: new mongoose.Types.ObjectId(pipelineId),
        "stageHistory.0": { $exists: true }, // At least one entry
      },
    },
    { $unwind: "$stageHistory" },
    {
      $group: {
        _id: "$stageHistory.stageId",
        avgDurationMs: { $avg: "$stageHistory.durationMs" },
        leadCount: { $sum: 1 },
      },
    },
  ]);

  const stages = await PipelineStage.find({
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  })
    .sort({ order: 1 })
    .lean();

  const statsMap = new Map(agg.map((r: any) => [r._id.toString(), r]));

  return stages.map((stage) => {
    const stats = statsMap.get(stage._id.toString());
    const avgMs = stats?.avgDurationMs ?? 0;
    return {
      stageId: stage._id.toString(),
      stageName: stage.name,
      stageColor: stage.color,
      avgDurationDays: Math.round((avgMs / (1000 * 60 * 60 * 24)) * 10) / 10,
      avgDurationHours: Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10,
      leadCount: stats?.leadCount ?? 0,
    };
  });
};

// ─── 8. Score distribution ────────────────────────────────────────────────────

export const getScoreDistribution = async (clientCode: string) => {
  const { Lead } = await getCrmModels(clientCode);

  const agg = await Lead.aggregate([
    { $match: { clientCode, isArchived: false, status: "open" } },
    {
      $bucket: {
        groupBy: "$score.total",
        boundaries: [0, 20, 40, 60, 80, 101],
        default: "Other",
        output: {
          count: { $sum: 1 },
          avgDealValue: { $avg: { $ifNull: ["$dealValue", 0] } },
        },
      },
    },
  ]);

  const labels = ["0-19", "20-39", "40-59", "60-79", "80-100"];
  return agg.map((bucket: any, i: number) => ({
    range: labels[i] ?? "Other",
    count: bucket.count,
    avgDealValue: Math.round(bucket.avgDealValue ?? 0),
  }));
};

// ─── 9. Predictive Intelligence ───────────────────────────────────────────────

/**
 * Calculates a predictive conversion probability (0-100) based on:
 * 1. Current lead score (weighted 40%)
 * 2. Current pipeline stage probability (weighted 60%)
 */
export const getPredictiveConversionScore = async (
  clientCode: string,
  leadId: string,
): Promise<number> => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return 0;

  let stageProb = 0;
  if (lead.stageId) {
    const stage = await PipelineStage.findById(lead.stageId).lean();
    stageProb = stage?.probability || 0;
  }

  const leadScore = lead.score?.total || 0;

  // Simple weighted logic for v1
  const weighted = leadScore * 0.4 + stageProb * 0.6;
  return Math.round(Math.min(100, Math.max(0, weighted)));
};

// ─── 10. Tiered Analytics Report (Weaponized ROI) ───────────────────────────

/**
 * Returns a comprehensive analytics report categorized into tiers.
 * Basic: Core visibility (Pulse)
 * Medium: Operational efficiency (Growth)
 * Advanced: Strategic foresight & AI (Weapon)
 */
/**
 * Orchestrates a complete, tiered analytics report for the executive dashboard.
 *
 * **WORKING PROCESS:**
 * 1. Tier 1 (Pulse): Fetches baseline overview KPIs (leads, activity).
 * 2. Tier 2 (Growth): Analyzes lead sources, funnel conversion, and score distribution.
 * 3. Tier 3 (Weapon): Generates advanced foresight data like revenue forecasts, bottleneck analysis, and heatmaps.
 * 4. Insight Engine: Applies heuristic rules to the results to generate actionable text recommendations (e.g., "Review funnel stages").
 *
 * **EDGE CASES:**
 * - Inconsistent Ranges: Flexibly switches heatmap range (e.g., forcing 90d for 365d reports) to maintain chart readability.
 *
 * @param clientCode - Tenant identifier.
 * @param range - High-level range.
 * @param pipelineId - Main pipeline to focus on.
 */
export const getTieredReport = async (
  clientCode: string,
  range?: AnalyticsRange,
  pipelineId?: string,
  from?: any,
  to?: any,
) => {
  // 1. Basic Metrics (The Pulse)
  const overview = await getOverview(clientCode, range, from, to);

  // 2. Medium Metrics (Growth)
  const sources = await getSourceBreakdown(clientCode, range, from, to);
  const funnel = pipelineId
    ? await getFunnelData(clientCode, pipelineId)
    : null;
  const distribution = await getScoreDistribution(clientCode);

  // 3. Advanced Metrics (The Weapon)
  const forecast = await getRevenueForecast(clientCode, pipelineId);
  const velocity = pipelineId
    ? await getPipelineVelocity(clientCode, pipelineId)
    : null;
  const heatmap = await getActivityHeatmap(
    clientCode,
    range === "365d" ? "90d" : range,
    from,
    to,
  );

  const insights = [
    overview.conversionRate > 20
      ? "High conversion detected. Consider scaling sources."
      : "Conversion rate below target. Review funnel stages.",
    forecast.grandTotal > 50000
      ? "Strong pipeline detected. Strategic follow-ups recommended."
      : "Pipeline health needs attention.",
  ];

  const charts = {
    basic: {
      totalLeads: overview.totalLeads,
      newLeads: overview.newLeadsInPeriod,
      activeLeads: overview.openLeads,
      activities: overview.activitiesInPeriod,
    },
    medium: {
      conversionRate: overview.conversionRate,
      pipelineValue: overview.totalPipelineValue,
      sources,
      funnel,
      scoreDistribution: distribution,
    },
    advanced: {
      projectedRevenue: forecast.grandTotal,
      forecastRows: forecast.rows,
      bottlenecks: velocity,
      activityHeatmap: heatmap,
      insights,
    },
  } as const;

  console.log(charts, insights);
  return charts;
};

/**
 * Consolidates regular CRM overview and WhatsApp analytics into a single response.
 */
export const getDashboardSummary = async (
  clientCode: string,
  range?: AnalyticsRange,
  from?: any,
  to?: any,
) => {
  const [overview, whatsapp] = await Promise.all([
    getOverview(clientCode, range, from, to),
    getWhatsAppAnalytics(clientCode, range, from, to),
  ]);

  return {
    overview,
    whatsapp,
  };
};
