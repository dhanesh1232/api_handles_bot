import { BaseRepository } from "../../../lib/tenant/base.repository";
import { getCrmModels } from "../../../lib/tenant/get.crm.model";

/**
 * AutomationRuleRepository
 */
export class AutomationRuleRepository extends BaseRepository<IAutomationRule> {
  async findActiveRules(trigger: string, extraFilters: any = {}) {
    return this.findMany({
      trigger,
      isActive: true,
      ...extraFilters,
    });
  }
}

/**
 * Factory
 */
export async function getAutomationRuleRepo(
  clientCode: string,
): Promise<AutomationRuleRepository> {
  const { AutomationRule } = await getCrmModels(clientCode);
  return new AutomationRuleRepository(AutomationRule, clientCode);
}
