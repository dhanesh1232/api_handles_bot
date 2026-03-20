import { BaseRepository } from "@lib/tenant/base.repository";
import { getCrmModels } from "@lib/tenant/crm.models";

/**
 * AutomationRuleRepository
 */
/**
 * Repository for managing Automation Rules within a tenant's database.
 *
 * **RESPONSIBILITY:**
 * Handles CRUD operations and specialized queries for automation rules, ensuring rules are correctly filtered by their triggers and active status.
 */
export class AutomationRuleRepository extends BaseRepository<IAutomationRule> {
  /**
   * Retrieves all enabled rules that match the given trigger(s).
   *
   * **WORKING PROCESS:**
   * 1. Trigger Normalization: Accepts either a single trigger string or an array of aliases.
   * 2. Active Filter: Enforces `isActive: true` to ensure disabled rules are never executed.
   * 3. Composite Query: Merges the trigger criteria with any `extraFilters` (e.g., stage-specific or tag-specific constraints).
   *
   * **EDGE CASES:**
   * - No Matches: Returns an empty array if no rules are found, handled gracefully by `AutomationService`.
   *
   * @param trigger - The event trigger name or list of aliases.
   * @param extraFilters - Additional MongoDB query constraints.
   */
  async findActiveRules(trigger: string | string[], extraFilters: any = {}) {
    return this.findMany({
      trigger: Array.isArray(trigger) ? { $in: trigger } : trigger,
      isActive: true,
      ...extraFilters,
    });
  }
}

/**
 * Factory function to initialize an AutomationRuleRepository.
 *
 * **WORKING PROCESS:**
 * 1. Model Resolution: Dynamically retrieves the tenant-specific `AutomationRule` model.
 * 2. Injection: Returns a new instance of the repository bound to the tenant's connection.
 */
export async function getAutomationRuleRepo(
  clientCode: string,
): Promise<AutomationRuleRepository> {
  const { AutomationRule } = await getCrmModels(clientCode);
  return new AutomationRuleRepository(AutomationRule, clientCode);
}
