import type { Schema } from "mongoose";
import AutomationRuleSchema from "./crm/automationRule.model.ts";
import LeadSchema from "./crm/lead.model.ts";
import LeadActivitySchema from "./crm/leadActivity.model.ts";
import LeadNoteSchema from "./crm/leadNote.model.ts";
import PipelineSchema from "./crm/pipeline.model.ts";
import PipelineStageSchema from "./crm/pipelineStage.model.ts";
import ConversationSchema from "./whatsapp/conversation.model.ts";
import MessageSchema from "./whatsapp/message.model.ts";
import TemplateSchema from "./whatsapp/template.model.ts";

export {
  AutomationRuleSchema,
  ConversationSchema,
  LeadActivitySchema,
  LeadNoteSchema,
  LeadSchema,
  MessageSchema,
  PipelineSchema,
  PipelineStageSchema,
  TemplateSchema,
};

export const schemas: Record<string, Schema<any>> = {
  conversations: ConversationSchema,
  messages: MessageSchema,
  templates: TemplateSchema,
  leads: LeadSchema,
  pipelines: PipelineSchema,
  pipelineStages: PipelineStageSchema,
  automationRules: AutomationRuleSchema,
  leadActivities: LeadActivitySchema,
  leadNotes: LeadNoteSchema,
};
