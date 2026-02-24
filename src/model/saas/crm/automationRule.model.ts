/**
 * automationRule.model.ts
 * Rules that fire when a lead enters a stage, score changes, etc.
 * Place at: src/model/saas/crm/automationRule.model.ts
 */

import mongoose, { type Model, type Schema } from "mongoose";

const conditionSchema = new mongoose.Schema<IAutomationCondition>(
  {
    field: { type: String, required: true },
    operator: {
      type: String,
      enum: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"],
      required: true,
    },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const actionSchema = new mongoose.Schema<IAutomationAction>(
  {
    type: {
      type: String,
      enum: [
        "send_whatsapp",
        "send_email",
        "move_stage",
        "assign_to",
        "add_tag",
        "remove_tag",
        "webhook_notify",
        "create_meeting",
      ],
      required: true,
    },
    delayMinutes: { type: Number, default: 0 },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const automationRuleSchema: Schema<IAutomationRule> = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, index: true },
    name: { type: String, required: true },
    trigger: {
      type: String,
      enum: [
        "stage_enter",
        "stage_exit",
        "lead_created",
        "deal_won",
        "deal_lost",
        "score_above",
        "score_below",
        "no_contact",
        "tag_added",
        "tag_removed",
      ],
      required: true,
    },
    triggerConfig: {
      stageId: { type: mongoose.Schema.Types.ObjectId, default: null },
      pipelineId: { type: mongoose.Schema.Types.ObjectId, default: null },
      scoreThreshold: { type: Number, default: null },
      tagName: { type: String, default: null },
      inactiveDays: { type: Number, default: null },
    },
    condition: { type: conditionSchema, default: null },
    actions: { type: [actionSchema], required: true, default: [] },
    isActive: { type: Boolean, default: true },
    executionCount: { type: Number, default: 0 },
    lastExecutedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

automationRuleSchema.index({ clientCode: 1, trigger: 1, isActive: 1 });
automationRuleSchema.index({ clientCode: 1, "triggerConfig.stageId": 1 });

const AutomationRule: Model<IAutomationRule> =
  mongoose.models.AutomationRule ||
  mongoose.model<IAutomationRule>("AutomationRule", automationRuleSchema);

export default AutomationRule;
export { automationRuleSchema as AutomationRuleSchema };
