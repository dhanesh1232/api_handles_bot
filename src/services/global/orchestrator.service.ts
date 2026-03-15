import { getCrmModels } from "@lib/tenant/crm.models";
import { Blueprint } from "@models/global/blueprint.model";
import { AuditService } from "./audit.service";

/**
 * Orchestrator Service
 * Handles the deployment of Blueprints (Gold Standard Configs) into Tenant Databases.
 */
export const OrchestratorService = {
  /**
   * Clones a blueprint's content into a specific client's tenant database.
   * This is a "power move" for agencies to rapidly onboard new clients.
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
