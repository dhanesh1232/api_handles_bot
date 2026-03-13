import { crmQueue } from "@/jobs/saas/crmWorker";
import { getCrmModels } from "@/lib/tenant/get.crm.model";
import { EventBus } from "../event/eventBus.service.ts";

export function calculateScore(lead: any, scoringConfig: any): number {
  let totalPoints = 0;
  for (const rule of scoringConfig.rules) {
    const fieldValue = rule.field
      .split(".")
      .reduce(
        (obj: any, key: string) =>
          obj && typeof obj === "object" ? obj[key] : undefined,
        lead,
      );

    let isMatch = false;
    switch (rule.operator) {
      case "exists":
        isMatch = fieldValue !== undefined && fieldValue !== null;
        break;
      case "not_exists":
        isMatch = fieldValue === undefined || fieldValue === null;
        break;
      case "equals":
        isMatch = fieldValue == rule.value;
        break;
      case "not_equals":
        isMatch = fieldValue != rule.value;
        break;
      case "greater_than":
        isMatch = Number(fieldValue) > Number(rule.value);
        break;
      case "less_than":
        isMatch = Number(fieldValue) < Number(rule.value);
        break;
      case "contains":
        isMatch = Array.isArray(fieldValue)
          ? fieldValue.includes(rule.value)
          : typeof fieldValue === "string" && fieldValue.includes(rule.value);
        break;
    }

    if (isMatch) {
      totalPoints += rule.points;
    }
  }
  return Math.max(0, Math.min(100, Math.round(totalPoints)));
}

export function getScoreBreakdown(lead: any, scoringConfig: any) {
  return scoringConfig.rules.map((rule: any) => {
    const fieldValue = rule.field
      .split(".")
      .reduce(
        (obj: any, key: string) =>
          obj && typeof obj === "object" ? obj[key] : undefined,
        lead,
      );

    let isMatch = false;
    switch (rule.operator) {
      case "exists":
        isMatch = fieldValue !== undefined && fieldValue !== null;
        break;
      case "not_exists":
        isMatch = fieldValue === undefined || fieldValue === null;
        break;
      case "equals":
        isMatch = fieldValue == rule.value;
        break;
      case "not_equals":
        isMatch = fieldValue != rule.value;
        break;
      case "greater_than":
        isMatch = Number(fieldValue) > Number(rule.value);
        break;
      case "less_than":
        isMatch = Number(fieldValue) < Number(rule.value);
        break;
      case "contains":
        isMatch = Array.isArray(fieldValue)
          ? fieldValue.includes(rule.value)
          : typeof fieldValue === "string" && fieldValue.includes(rule.value);
        break;
    }

    return {
      label: rule.label,
      field: rule.field,
      matched: isMatch,
      points: rule.points,
      appliedPoints: isMatch ? rule.points : 0,
    };
  });
}

export async function recalculateLeadScore(clientCode: string, leadId: string) {
  const { ScoringConfig, Lead } = await getCrmModels(clientCode);

  const lead = await Lead.findById(leadId);
  if (!lead) return null;

  const config = await ScoringConfig.findOne({ clientCode });
  let newScore = 0;
  let breakdown: any[] = [];

  if (config && config.rules && config.rules.length > 0) {
    newScore = calculateScore(lead.toJSON(), config);
    breakdown = getScoreBreakdown(lead.toJSON(), config);

    if (lead.score && typeof lead.score === "object") {
      lead.score.total = newScore;
    } else {
      lead.score = { total: newScore } as any;
    }
    await lead.save();

    if (newScore >= (config.hotThreshold || 70)) {
      void EventBus.emit(clientCode, "lead.score_refreshed", {
        phone: lead.phone,
        email: lead.email,
        data: lead.toJSON(),
        variables: { score: String(newScore), trigger: "score_above" },
      });
    }
  } else {
    // legacy hardcoded logic
    let score = 0;
    if (lead.phone) score += 10;
    if (lead.email) score += 10;
    if (lead.status !== "archived") score += 20;
    newScore = score;

    if (lead.score && typeof lead.score === "object") {
      lead.score.total = newScore;
    } else {
      lead.score = { total: newScore } as any;
    }
    await lead.save();
  }

  return { score: newScore, breakdown };
}

export async function recalculateAllScores(clientCode: string) {
  const { Lead } = await getCrmModels(clientCode);
  const leads = await Lead.find({ isArchived: { $ne: true } });
  let processed = 0;

  for (const lead of leads) {
    await recalculateLeadScore(clientCode, lead._id.toString());
    processed++;
  }
  return processed;
}

export async function getScoringConfig(clientCode: string) {
  const { ScoringConfig } = await getCrmModels(clientCode);

  return ScoringConfig.findOne({ clientCode });
}

export async function updateScoringConfig(
  clientCode: string,
  rules: any[],
  hotThreshold: number,
  coldThreshold: number,
  recalculateOnTriggers: string[],
) {
  const { ScoringConfig, Lead } = await getCrmModels(clientCode);

  const config = await ScoringConfig.findOneAndUpdate(
    { clientCode },
    { $set: { rules, hotThreshold, coldThreshold, recalculateOnTriggers } },
    { upsert: true, new: true },
  );

  // Enqueue bulk recalculation job

  const leads = await Lead.find(
    { clientCode, isArchived: { $ne: true } },
    "_id",
  );

  for (const lead of leads) {
    await crmQueue.add(
      {
        clientCode,
        type: "crm.score_refresh",
        payload: { leadId: lead._id.toString() },
      },
      { delayMs: 100 },
    );
  }

  return config;
}
