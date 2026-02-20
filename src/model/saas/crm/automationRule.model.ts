import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface IAutomationAction {
  type: string;
  config: any;
}

export interface IAutomationRule extends Document {
  clientCode?: string;
  triggerEvent: string;
  conditions?: any;
  actions: IAutomationAction[];
  isActive: boolean;
}

const automationRuleSchema: Schema<IAutomationRule> = new mongoose.Schema({
  clientCode: String,
  triggerEvent: String, // DOCTOR_BOOKED, PAYMENT_SUCCESS
  conditions: mongoose.Schema.Types.Mixed,
  actions: [
    {
      type: { type: String }, // SEND_WHATSAPP, MOVE_STAGE
      config: mongoose.Schema.Types.Mixed,
    },
  ],
  isActive: { type: Boolean, default: true },
});

const AutomationRule: Model<IAutomationRule> =
  mongoose.models.AutomationRule ||
  mongoose.model<IAutomationRule>("AutomationRule", automationRuleSchema);

export default AutomationRule;
