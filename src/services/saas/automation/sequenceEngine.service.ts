import { crmQueue } from "../../../jobs/saas/crmWorker.ts";
import {
  getTenantConnection,
  getTenantModel,
} from "../../../lib/connectionManager.ts";
import { getCrmModels } from "../../../lib/tenant/get.crm.model.ts";
import { schemas } from "../../../model/saas/tenant.schemas.ts";

export async function enrollInSequence(
  clientCode: string,
  ruleId: string,
  lead: any,
  eventVariables: any = {},
): Promise<string> {
  const { AutomationRule } = await getCrmModels(clientCode);
  const rule = await AutomationRule.findById(ruleId);

  if (!rule || !rule.isSequence || !rule.steps || rule.steps.length === 0) {
    throw new Error("Invalid rule or not a sequence");
  }

  const tenantConn = await getTenantConnection(clientCode);
  const SequenceEnrollment = getTenantModel<any>(
    tenantConn,
    "SequenceEnrollment",
    schemas.sequenceEnrollments,
  );

  const firstStep = rule.steps[0];
  const nextStepAt = new Date(
    Date.now() + (firstStep.delayMinutes || 0) * 60 * 1000,
  );

  const enrollment = await SequenceEnrollment.create({
    ruleId: rule._id,
    clientCode,
    phone: lead.phone,
    email: lead.email,
    trigger: rule.trigger,
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
  const tenantConn = await getTenantConnection(clientCode);
  const SequenceEnrollment = getTenantModel<any>(
    tenantConn,
    "SequenceEnrollment",
    schemas.sequenceEnrollments,
  );
  const { AutomationRule, Lead } = await getCrmModels(clientCode);

  const enrollment = await SequenceEnrollment.findById(enrollmentId);
  if (!enrollment || enrollment.status !== "active") return;

  const rule = await AutomationRule.findById(enrollment.ruleId);
  if (!rule || !rule.steps) return;

  const lead = await Lead.findById(enrollment.leadId);
  const step = rule.steps[stepNumber];
  if (!step) return;

  const context = {
    lead: lead ? lead.toJSON() : {},
    event: enrollment.eventData || {},
    resolved: enrollment.resolvedVariables || {},
  };

  if (step.exitSequenceIf && step.exitSequenceIf.length > 0) {
    let shouldExit = false;
    for (const condition of step.exitSequenceIf) {
      if (evaluateCondition(condition, context)) {
        shouldExit = true;
        break;
      }
    }
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
    for (const condition of step.conditions) {
      if (!evaluateCondition(condition, context)) {
        conditionsPassed = false;
        break;
      }
    }
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
    const result = await executeStepAction(
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
  SequenceEnrollment: any,
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

async function executeStepAction(
  clientCode: string,
  action: any,
  context: any,
  io?: any,
): Promise<any> {
  switch (action.type) {
    case "send_whatsapp": {
      const { resolveTemplateVariables } =
        await import("../whatsapp/template.service.ts");
      const { createWhatsappService } =
        await import("../whatsapp/whatsapp.service.ts");
      const tenantConn = await getTenantConnection(clientCode);
      const Conversation = getTenantModel<any>(
        tenantConn,
        "Conversation",
        schemas.conversations,
      );

      const resolvedVariables = await resolveTemplateVariables(
        tenantConn,
        action.config.templateName,
        context,
      );

      let conv = await Conversation.findOne({ phone: context.lead.phone });
      if (!conv) {
        conv = await Conversation.create({
          phone: context.lead.phone,
          userName: context.lead.firstName || context.lead.phone,
          status: "open",
          channel: "whatsapp",
          unreadCount: 0,
        });
      }

      const svc = createWhatsappService(io || null);
      await svc.sendOutboundMessage(
        clientCode,
        conv._id.toString(),
        undefined,
        undefined,
        undefined,
        "automation",
        action.config.templateName,
        "en_US",
        resolvedVariables,
      );
      return { sent: true, phone: context.lead.phone };
    }
    case "send_email": {
      const { createEmailService } = await import("../mail/email.service.ts");
      const svc = createEmailService();
      const subject = resolveTemplateString(
        action.config.subject || "",
        context,
      );
      const htmlBody = resolveTemplateString(
        action.config.htmlBody || "",
        context,
      );
      await svc.sendEmail(clientCode, {
        to: context.lead.email || "",
        subject,
        html: htmlBody,
      });
      return { sent: true, email: context.lead.email };
    }
    case "generate_meet": {
      const { createGoogleMeetService } =
        await import("../meet/google.meet.service.ts");
      const svc = createGoogleMeetService();
      const summary = resolveTemplateString(
        action.config.summary || "Meeting",
        context,
      );
      const res = await svc.createMeeting(clientCode, {
        summary,
        attendees: context.lead.email ? [context.lead.email] : [],
      });
      if (!res.success)
        throw new Error(res.error || "Failed to create meeting");
      return { meetLink: res.hangoutLink, eventId: res.eventId };
    }
    case "callback_client": {
      const { sendCallbackWithRetry } =
        await import("../../../lib/callbackSender.ts");
      const url = resolveTemplateString(action.config.url || "", context);
      const res = await sendCallbackWithRetry({
        clientCode,
        callbackUrl: url,
        method: action.config.method || "PUT",
        payload: JSON.parse(
          resolveTemplateString(
            JSON.stringify(action.config.payload || {}),
            context,
          ),
        ),
      });
      return { called: true, url, success: res.success };
    }
    case "update_lead": {
      const { Lead } = await getCrmModels(clientCode);
      const fields = JSON.parse(
        resolveTemplateString(
          JSON.stringify(action.config.fields || {}),
          context,
        ),
      );
      await Lead.findByIdAndUpdate(context.lead._id, { $set: fields });
      return { updated: true };
    }
    case "tag_lead": {
      const { updateTags } = await import("../crm/lead.service.ts");
      await updateTags(
        clientCode,
        context.lead._id.toString(),
        [action.config.tag],
        [],
      );
      return { tagged: true };
    }
    case "move_pipeline_stage": {
      const { moveLead } = await import("../crm/lead.service.ts");
      await moveLead(
        clientCode,
        context.lead._id.toString(),
        action.config.stageId,
        "automation",
      );
      return { moved: true, stageId: action.config.stageId };
    }
    case "http_webhook": {
      const url = resolveTemplateString(action.config.url || "", context);
      const body = JSON.parse(
        resolveTemplateString(
          JSON.stringify(action.config.payload || {}),
          context,
        ),
      );
      const res = await fetch(url, {
        method: action.config.method || "POST",
        headers: {
          "Content-Type": "application/json",
          ...(action.config.headers || {}),
        },
        body: JSON.stringify(body),
      });
      return { status: res.status };
    }
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

function checkConditions(conditions: any[], context: any): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const condition of conditions) {
    if (!evaluateCondition(condition, context)) return false;
  }
  return true;
}

function evaluateCondition(condition: any, context: any): boolean {
  const value = condition.field
    .split(".")
    .reduce(
      (obj: any, key: string) =>
        obj && typeof obj === "object" ? obj[key] : undefined,
      context,
    );
  switch (condition.operator) {
    case "equals":
      return value == condition.value;
    case "not_equals":
      return value != condition.value;
    case "greater_than":
      return Number(value) > Number(condition.value);
    case "less_than":
      return Number(value) < Number(condition.value);
    case "contains":
      return (
        (Array.isArray(value) && value.includes(condition.value)) ||
        (typeof value === "string" && value.includes(condition.value))
      );
    case "exists":
      return value !== undefined && value !== null;
    case "not_exists":
      return value === undefined || value === null;
    default:
      return false;
  }
}

function resolveTemplateString(template: string, context: any): string {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = path
      .trim()
      .split(".")
      .reduce(
        (obj: any, key: string) =>
          obj && typeof obj === "object" ? obj[key] : undefined,
        context,
      );
    return value !== undefined ? String(value) : match;
  });
}
