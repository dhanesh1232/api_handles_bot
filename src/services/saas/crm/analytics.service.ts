/**
 * analyticsService.ts
 * CRM analytics: funnel, forecast, sources, team leaderboard, overview KPIs.
 *
 * All queries run against the client's own tenant DB via getCrmModels().
 */

import mongoose from "mongoose";
import { getCrmModels } from "../../../lib/tenant/getCrmModels.ts";

// ─── Helper: date range ───────────────────────────────────────────────────────

const getDateRange = (range: "7d" | "30d" | "90d" | "365d"): Date => {
  const ms = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };
  const days = ms[range] ?? 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
};

// ─── 1. Overview KPIs ─────────────────────────────────────────────────────────

export const getOverview = async (
  clientCode: string,
  range: "7d" | "30d" | "90d" | "365d" = "30d",
) => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);
  const since = getDateRange(range);

  const [totals, periodLeads, wonDeals, activities] = await Promise.all([
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
          openLeads: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        },
      },
    ]),
    Lead.countDocuments({
      clientCode,
      isArchived: false,
      createdAt: { $gte: since },
    }),
    Lead.aggregate([
      { $match: { clientCode, status: "won", convertedAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$dealValue", 0] } },
        },
      },
    ]),
    LeadActivity.countDocuments({ clientCode, createdAt: { $gte: since } }),
  ]);

  const t = totals[0] ?? {};
  const won = wonDeals[0] ?? { count: 0, revenue: 0 };

  return {
    totalLeads: (t as any).totalLeads ?? 0,
    openLeads: (t as any).openLeads ?? 0,
    newLeadsInPeriod: periodLeads,
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

export const getFunnelData = async (clientCode: string, pipelineId: string) => {
  const { Lead, PipelineStage } = await getCrmModels(clientCode);

  const stages = await PipelineStage.find({
    clientCode,
    pipelineId: new mongoose.Types.ObjectId(pipelineId),
  }).sort({ order: 1 });

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
    PipelineStage.find(stageQuery).sort({ order: 1 }),
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
  range: "7d" | "30d" | "90d" | "365d" = "30d",
) => {
  const { Lead } = await getCrmModels(clientCode);
  const since = getDateRange(range);

  const agg = await Lead.aggregate([
    { $match: { clientCode, isArchived: false, createdAt: { $gte: since } } },
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
  range: "7d" | "30d" | "90d" | "365d" = "30d",
) => {
  const { Lead, LeadActivity } = await getCrmModels(clientCode);
  const since = getDateRange(range);

  const [dealStats, activityStats] = await Promise.all([
    Lead.aggregate([
      {
        $match: {
          clientCode,
          isArchived: false,
          assignedTo: { $ne: null },
          updatedAt: { $gte: since },
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
          createdAt: { $gte: since },
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
  range: "30d" | "90d" = "30d",
) => {
  const { LeadActivity } = await getCrmModels(clientCode);
  const since = getDateRange(range);

  const agg = await LeadActivity.aggregate([
    { $match: { clientCode, createdAt: { $gte: since } } },
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
  }).sort({ order: 1 });

  const statsMap = new Map(changes.map((r: any) => [r._id, r]));

  return stages.map((stage: any) => ({
    stageId: stage._id.toString(),
    stageName: stage.name,
    stageColor: stage.color,
    moveCount: (statsMap.get(stage._id.toString()) as any)?.count ?? 0,
  }));
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
