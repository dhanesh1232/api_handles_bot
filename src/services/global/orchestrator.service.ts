import { getCrmModels } from "@lib/tenant/crm.models";
import { Blueprint } from "@models/global/blueprint.model";
import { AuditService } from "./audit.service";

/**
 * @module Services/Global/Orchestrator
 * @responsibility The "Clonability Engine" that deploys complex configurations (Blueprints) into Tenant Databases.
 *
 * **GOAL:** Enable "Agency Scale" where a master config (Stages, Colors, Probabilities, Rules) can be stamped onto new client accounts in sub-second time.
 */
export const OrchestratorService = {
  /**
   * Clones a blueprint's content into a specific client's tenant database.
   *
   * @param clientCode - The target tenant identifier.
   * @param blueprintId - MongoDB ID of the source blueprint.
   * @param performedBy - The actor ID (e.g., agency admin).
   *
   * @returns {Promise<Object>} Deployment summary including success status and list of components created.
   *
   * @throws {Error} "Blueprint not found" if the ID is invalid.
   *
   * **DETAILED EXECUTION:**
   * 1. **Source Discovery**: Fetches the blueprint from the global registry.
   * 2. **Target Resolution**: Dynamically connects to the tenant's DB via `getCrmModels`.
   * 3. **Transactional Loop (Pipelines)**:
   *    - For each pipeline in the blueprint, creates a record in the tenant DB.
   *    - Iterates through the blueprint's stages and creates them, linking to the new pipeline ID, maintaining order and conversion probabilities.
   * 4. **Automation Cloning**: Copies rules, triggers, and action payloads. All rules are forced to `isActive: true` by default.
   * 5. **Global Audit**: Logs the entire "Power Operation" to the `AuditService`.
   * 6. **Monetization (Token Consumption)**: Calls `UsageService.consume` to subtract 1 `automation_run` credit for this deployment.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Deduplication: This service DOES NOT check if a pipeline already exists. Repeated calls will result in duplicate pipelines.
   */
  deployBlueprint: async (
    clientCode: string,
    blueprintId: string,
    performedBy: string,
  ) => {
    const blueprint = await Blueprint.findById(blueprintId).lean();
    if (!blueprint) throw new Error("Blueprint not found");

    const { Pipeline, PipelineStage, AutomationRule, Lead } =
      await getCrmModels(clientCode);
    const { UsageService } = await import("./usage.service");

    const auditMeta: Record<string, any> = {
      blueprintId,
      blueprintName: blueprint.name,
      deployedComponents: [],
    };

    // 1. Deploy Pipelines & Stages
    if (blueprint.content.pipelines?.length) {
      for (const pConfig of blueprint.content.pipelines) {
        const pipeline = await Pipeline.create({
          clientCode,
          name: pConfig.name,
          description: pConfig.description,
          isDefault: pConfig.isDefault || false,
        });

        if (pConfig.stages?.length) {
          for (const sConfig of pConfig.stages) {
            await PipelineStage.create({
              clientCode,
              pipelineId: pipeline._id,
              name: sConfig.name,
              color: sConfig.color,
              order: sConfig.order,
              probability: sConfig.probability,
              isWon: sConfig.isWon || false,
              isLost: sConfig.isLost || false,
            });
          }
        }
        auditMeta.deployedComponents.push(`pipeline:${pipeline.name}`);
      }
    }

    // 2. Deploy Automation Rules
    if (blueprint.content.automationRules?.length) {
      for (const rConfig of blueprint.content.automationRules) {
        await AutomationRule.create({
          clientCode,
          name: rConfig.name,
          trigger: rConfig.trigger,
          triggerConfig: rConfig.triggerConfig,
          conditions: rConfig.conditions || [],
          conditionLogic: rConfig.conditionLogic || "AND",
          actions: rConfig.actions || [],
          isActive: true, // Auto-activate on deploy
        });
        auditMeta.deployedComponents.push(`automation:${rConfig.name}`);
      }
    }

    // 3. Log the Orchestration event globally
    await AuditService.log({
      clientCode,
      action: "agency.blueprint.deploy",
      resourceType: "Blueprint",
      resourceId: blueprintId,
      performedBy,
      severity: "info",
      metadata: auditMeta,
    });

    // Deduct "Automation Run" credits for blueprint deployment
    await UsageService.consume(clientCode, "automation_run", 1);

    return {
      success: true,
      message: `Blueprint "${blueprint.name}" deployed to ${clientCode}`,
      components: auditMeta.deployedComponents,
    };
  },
};
