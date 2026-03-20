import { logger } from "@/lib/logger";

export class ConditionEvaluator {
  /**
   * Primary entry point for evaluating complex logic groups (AND/OR).
   *
   * **WORKING PROCESS:**
   * 1. Validation: Returns `true` if no conditions exist (default-pass).
   * 2. Logic Branching:
   *    - **OR**: Short-circuits and returns `true` as soon as one condition passes (`Array.some`).
   *    - **AND**: Short-circuits and returns `false` if any condition fails (`Array.every`).
   *
   * @param {"AND" | "OR"} logic - The logical operator for the group.
   * @param {any[]} conditions - List of individual condition objects.
   * @param {any} context - The data source (lead, event, etc.) to evaluate against.
   * @returns {boolean} Whether the logic group passes.
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
   * Deep-evaluates a single condition against a specific field path in the context.
   *
   * **WORKING PROCESS:**
   * 1. Field Resolution: Performs a deep-walk (`split(".")`) to resolve values like `lead.metadata.score`.
   * 2. Normalization: Standardizes values for case-insensitive comparison (contains/starts_with).
   * 3. Comparison: Executes the specific operator logic (regex, null-check, days-since, etc.).
   *
   * **EDGE CASES:**
   * - Missing Field: If the path is invalid, resolves to `undefined` and comparison fails (or passes if `not_exists`).
   * - Invalid Regex: Catches `RegExp` syntax errors and returns `false`.
   * - Sparse Data: `exists`/`not_exists` handles `null`, `undefined`, and empty strings uniformly.
   *
   * @param {any} condition - Single condition object { field, operator, value }.
   * @param {any} context - Data source.
   * @returns {boolean} Result of the evaluation.
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
