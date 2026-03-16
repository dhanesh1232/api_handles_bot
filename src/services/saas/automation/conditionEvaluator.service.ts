import { logger } from "@/lib/logger";

export class ConditionEvaluator {
  /**
   * Evaluates a group of conditions with a specific logic (AND/OR).
   */
  static evaluate(
    logic: "AND" | "OR",
    conditions: any[],
    context: any,
  ): boolean {
    if (!conditions || conditions.length === 0) return true;

    if (logic === "OR") {
      return conditions.some((c) =>
        ConditionEvaluator.evaluateSingle(c, context),
      );
    }

    return conditions.every((c) =>
      ConditionEvaluator.evaluateSingle(c, context),
    );
  }

  /**
   * Evaluates a single condition against the context.
   * Supports both short and descriptive operator names.
   */
  static evaluateSingle(condition: any, context: any): boolean {
    if (!condition || !condition.field) return true;

    try {
      const value = condition.field
        .split(".")
        .reduce(
          (o: any, i: string) =>
            o && typeof o === "object" ? o[i] : undefined,
          context,
        );

      const targetValue = condition.value;
      const op = condition.operator;

      switch (op) {
        case "eq":
        case "equals":
          return value === targetValue;

        case "neq":
        case "not_equals":
          return value !== targetValue;

        case "gt":
        case "greater_than":
          return Number(value) > Number(targetValue);

        case "gte":
        case "greater_than_equals":
          return Number(value) >= Number(targetValue);

        case "lt":
        case "less_than":
          return Number(value) < Number(targetValue);

        case "lte":
        case "less_than_equals":
          return Number(value) <= Number(targetValue);

        case "in":
          if (Array.isArray(targetValue)) {
            return targetValue.includes(value);
          }
          if (typeof targetValue === "string") {
            return targetValue
              .split(",")
              .map((s) => s.trim())
              .includes(String(value));
          }
          return false;

        case "contains":
          return String(value || "")
            .toLowerCase()
            .includes(String(targetValue || "").toLowerCase());

        case "starts_with":
          return String(value || "")
            .toLowerCase()
            .startsWith(String(targetValue || "").toLowerCase());

        case "ends_with":
          return String(value || "")
            .toLowerCase()
            .endsWith(String(targetValue || "").toLowerCase());

        case "regex":
          try {
            return new RegExp(String(targetValue), "i").test(
              String(value || ""),
            );
          } catch (e) {
            return false;
          }

        case "days_since_gte":
          return Number(value || 0) >= Number(targetValue || 0);

        case "days_since_lte":
          return Number(value || 0) <= Number(targetValue || 0);

        case "exists":
          return value !== undefined && value !== null && value !== "";

        case "not_exists":
          return value === undefined || value === null || value === "";

        default:
          logger.warn(`[ConditionEvaluator] Unknown operator: ${op}`);
          return true;
      }
    } catch (err: any) {
      logger.warn(
        `[ConditionEvaluator] Evaluation failed for ${condition.field}: ${err.message}`,
      );
      return false;
    }
  }
}
