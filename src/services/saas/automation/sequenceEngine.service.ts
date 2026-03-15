import { getCrmModels } from "@lib/tenant/crm.models";
import { crmQueue } from "@/jobs/saas/crmWorker";
import { ActionExecutor } from "./actionExecutor.service.ts";
import { ConditionEvaluator } from "./conditionEvaluator.service.ts";

export async function enrollInSequence(
  clientCode: string,
  ruleId: string,
  lead: any,
  eventVariables: any = {},
): Promise<string> {
  const { AutomationRule, SequenceEnrollment } = await getCrmModels(clientCode);
  const rule = await AutomationRule.findById(ruleId);

  if (!rule || !rule.isSequence || !rule.steps || rule.steps.length === 0) {
    throw new Error("Invalid rule or not a sequence");
  }

  const firstStep = rule?.steps[0];
  const nextStepAt = new Date(
    Date.now() + (firstStep?.delayMinutes || 0) * 60 * 1000,
  );

  const enrollment = await SequenceEnrollment.create({
    ruleId: rule?._id,
    clientCode,
    phone: lead.phone,
    email: lead.email,
    trigger: rule?.trigger,
    leadId: lead._id,
    eventData: eventVariables,
    resolvedVariables: {
      phone: lead.phone,
      email: lead.email,
      leadId: lead._id?.toString(),
    },
    currentStep: 0,
    totalSteps: rule.steps.length,
    status: "active",
    stepResults: [],
    nextStepAt,
  });

  await AutomationRule.findByIdAndUpdate(ruleId, {
    $inc: { activeEnrollments: 1 },
  });

  // Enqueue the first step via crmWorker queue
  await crmQueue.add(
    {
      clientCode,
      type: "crm.sequence_step",
      payload: {
        enrollmentId: enrollment._id.toString(),
        stepNumber: 0,
      },
    },
    { delayMs: (firstStep.delayMinutes || 0) * 60 * 1000 },
  );

  return enrollment._id.toString();
}

export async function executeStep(
  clientCode: string,
  enrollmentId: string,
  stepNumber: number,
  io?: any,
): Promise<void> {
  const { AutomationRule, Lead, SequenceEnrollment } =
    await getCrmModels(clientCode);

  const enrollment = await SequenceEnrollment.findById(enrollmentId);
  if (!enrollment || enrollment.status !== "active") return;

  const rule = await AutomationRule.findById(enrollment.ruleId);
  if (!rule || !rule.steps) return;

  const lead = await Lead.findById(enrollment.leadId);
  const step = rule.steps[stepNumber];
  if (!step) return;

  const context = {
    lead: lead ? lead : {},
    event: enrollment.eventData || {},
    resolved: enrollment.resolvedVariables || {},
  };

  if (step.exitSequenceIf && step.exitSequenceIf.length > 0) {
    const shouldExit = ConditionEvaluator.evaluate(
      "OR",
      step.exitSequenceIf,
      context,
    );
    if (shouldExit) {
      enrollment.status = "exited";
      enrollment.exitReason = "exit_condition_met";
      await enrollment.save();
      await AutomationRule.findByIdAndUpdate(rule._id, {
        $inc: { activeEnrollments: -1, completedEnrollments: 1 },
      });
      return;
    }
  }

  let conditionsPassed = true;
  if (step.conditions && step.conditions.length > 0) {
    conditionsPassed = ConditionEvaluator.evaluate(
      "AND",
      step.conditions,
      context,
    );
  }

  if (!conditionsPassed) {
    enrollment.stepResults.push({
      stepNumber,
      status: "skipped",
      executedAt: new Date(),
    });
    return advanceToNextStep(
      rule,
      enrollment,
      stepNumber,
      clientCode,
      SequenceEnrollment,
      AutomationRule,
    );
  }

  try {
    const result = await ActionExecutor.execute(
      clientCode,
      step.action,
      context,
      io,
    );
    enrollment.stepResults.push({
      stepNumber,
      status: "completed",
      executedAt: new Date(),
      result,
    });

    if (step.action.type === "generate_meet" && result.meetLink) {
      const storeAs = step.action.config?.storeAs ?? "meetLink";
      enrollment.resolvedVariables = {
        ...enrollment.resolvedVariables,
        [storeAs]: result.meetLink,
      };
      enrollment.markModified("resolvedVariables");
    }
  } catch (err: any) {
    enrollment.stepResults.push({
      stepNumber,
      status: "failed",
      executedAt: new Date(),
      error: err.message,
    });

    if (step.onFailure === "stop") {
      enrollment.status = "failed";
      await enrollment.save();
      return;
    }
  }

  await advanceToNextStep(
    rule,
    enrollment,
    stepNumber,
    clientCode,
    SequenceEnrollment,
    AutomationRule,
  );
}

async function advanceToNextStep(
  rule: any,
  enrollment: any,
  stepNumber: number,
  clientCode: string,
  _SequenceEnrollment: any,
  AutomationRule: any,
) {
  const nextStepNum = stepNumber + 1;
  if (nextStepNum >= rule.steps.length) {
    enrollment.status = "completed";
    enrollment.completedAt = new Date();
    await enrollment.save();
    await AutomationRule.findByIdAndUpdate(rule._id, {
      $inc: { activeEnrollments: -1, completedEnrollments: 1 },
    });
  } else {
    const nextStep = rule.steps[nextStepNum];
    const delayMs = (nextStep.delayMinutes || 0) * 60 * 1000;
    enrollment.currentStep = nextStepNum;
    enrollment.nextStepAt = new Date(Date.now() + delayMs);
    await enrollment.save();

    await crmQueue.add(
      {
        clientCode,
        type: "crm.sequence_step",
        payload: {
          clientCode,
          enrollmentId: enrollment._id.toString(),
          stepNumber: nextStepNum,
        },
      },
      { delayMs },
    );
  }
}

// resolveTemplateString removed in favor of ActionExecutor.resolveTemplate (internal)
