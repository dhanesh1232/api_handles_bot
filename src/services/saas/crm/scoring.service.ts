import { getCrmModels } from "@lib/tenant/crm.models";
import { crmQueue } from "@/jobs/saas/crmWorker";
import { EventBus } from "../event/eventBus.service.ts";

/**
 * @module Services/CRM/Scoring
 * @responsibility Quantitative Lead Prioritization and Qualification.
 *
 * **GOAL:** Provide a dynamic, rule-based engine that calculates a 0-100 "Heat" score for leads based on their attributes, activity, and source.
 */

/**
 * Pure function to calculate a lead's numerical score (0-100) based on configuration.
 *
 * **WORKING PROCESS:**
 * 1. Logic Traversal: Iterates through each rule in the `scoringConfig`.
 * 2. Dynamic Path Resolution: Extracts field values using dot-notation (e.g., "score.total") via `field.split('.').reduce`.
 * 3. Operational Check: Evaluates the field against the rule's operator (exists, equals, contains, etc.).
 * 4. Point Accumulation: Adds the rule's `points` to the total if the condition matches.
 * 5. normalization: Clips the final score between 0 and 100.
 *
 * **EDGE CASES:**
 * - Nested Fields: Safely handles deep property access, returning `undefined` if the path is broken.
 * - Type Casting: Ensures numeric comparisons (`greater_than`, `less_than`) treat inputs as `Number`.
 */
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
        isMatch = fieldValue === rule.value;
        break;
      case "not_equals":
        isMatch = fieldValue !== rule.value;
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

/**
 * Detailed audit of how a score was derived.
 *
 * @param lead - The subject lead record.
 * @param scoringConfig - The tenant's scoring rules.
 * @returns An array of rule evaluations showing status (matched/missed) and point contribution.
 *
 * **DETAILED EXECUTION:**
 * 1. **Rule Simulation**: Re-runs the `calculateScore` logic but instead of aggregating, it maps each rule to a descriptor.
 * 2. **UI Transparency**: Provides `appliedPoints` vs `points` to help users understand why a lead has a specific score.
 */
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
        isMatch = fieldValue === rule.value;
        break;
      case "not_equals":
        isMatch = fieldValue !== rule.value;
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

/**
 * Recalculates and persists a lead's score based on current data and config.
 *
 * **WORKING PROCESS:**
 * 1. Data Fetch: Retrieves both the `Lead` document and the tenant's `ScoringConfig`.
 * 2. Evaluation: Runs the core `calculateScore` logic.
 * 3. Transition Check: If the new score crosses the `hotThreshold`, it emits a `lead.score_refreshed` event.
 * 4. Legacy Fallback: If no custom config is found, applies a basic point system (phone=10, email=10, open=20).
 *
 * **EDGE CASES:**
 * - Absent Config: Seamlessly falls back to legacy logic to ensure every lead has a baseline score.
 */
export async function recalculateLeadScore(clientCode: string, leadId: string) {
  const { ScoringConfig, Lead } = await getCrmModels(clientCode);

  const lead = await Lead.findById(leadId);
  if (!lead) return null;

  const config = await ScoringConfig.findOne({ clientCode }).lean();
  let newScore = 0;
  let breakdown: any[] = [];

  if (config?.rules && config.rules.length > 0) {
    newScore = calculateScore(lead as any, config);
    breakdown = getScoreBreakdown(lead as any, config);

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
        data: lead as any,
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

/**
 * Triggers a serial, high-integrity recalculation for all active leads in a tenant.
 *
 * @param clientCode - The tenant identifier.
 * @returns Total count of leads processed.
 *
 * **DETAILED EXECUTION:**
 * 1. **Active Filtering**: Scans the `Lead` collection for non-archived records.
 * 2. **Sequential Refresh**: Iterates through each lead, invoking `recalculateLeadScore` to ensure database consistency.
 */
export async function recalculateAllScores(clientCode: string) {
  const { Lead } = await getCrmModels(clientCode);
  const leads = await Lead.find({ isArchived: { $ne: true } }).lean();
  let processed = 0;

  for (const lead of leads) {
    await recalculateLeadScore(clientCode, lead._id.toString());
    processed++;
  }
  return processed;
}

/**
 * Retrieves the current scoring configuration for a tenant.
 
 */
/**
 * Retrieves the current scoring configuration for a tenant.
 *
 * @param clientCode - The tenant identifier.
 * @returns The `ScoringConfig` document or null.
 */
export async function getScoringConfig(clientCode: string) {
  const { ScoringConfig } = await getCrmModels(clientCode);

  return ScoringConfig.findOne({ clientCode }).lean();
}

/**
 * Updates the scoring configuration and triggers a background bulk refresh.
 *
 * @param clientCode - The tenant identifier.
 * @param rules - Array of new scoring conditions.
 * @param hotThreshold - Score at which a lead is considered "Hot".
 * @param coldThreshold - Score at which a lead is considered "Cold".
 * @param recalculateOnTriggers - List of events that should trigger a re-score.
 *
 * **DETAILED EXECUTION:**
 * 1. **Atomic Update**: Uses `findOneAndUpdate` with `upsert: true` to persist the new config profile.
 * 2. **Bulk Invalidation**: Scans all active leads and enqueues a `crm.score_refresh` job in the `crmQueue` for each.
 * 3. **Throttled Refresh**: Adds a `delayMs` to each job to prevent a database IO spike during large refreshes.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Scalability: Processes lead IDs in a lean `.lean()` query to minimize memory footprint before enqueuing to BullMQ.
 */
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
    { upsert: true, returnDocument: "after" },
  ).lean();

  // Enqueue bulk recalculation job

  const leads = await Lead.find(
    { clientCode, isArchived: { $ne: true } },
    "_id",
  ).lean();

  for (const lead of leads) {
    await crmQueue.add(
      clientCode,
      {
        type: "crm.score_refresh",
        payload: { leadId: lead._id.toString() },
      },
      { delayMs: 100 },
    );
  }

  return config;
}
