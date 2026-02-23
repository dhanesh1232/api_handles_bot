import type { Schema } from "mongoose";
import AutomationRule from "./crm/automationRule.model.ts";
import Lead from "./crm/lead.model.ts";
import LeadActivity from "./crm/leadActivity.model.ts";
import LeadNote from "./crm/leadNote.model.ts";
import Pipeline from "./crm/pipeline.model.ts";
import PipelineStage from "./crm/pipelineStage.model.ts";
import CommunicationWorkflow from "./whatsapp/communication-workflow.model.ts";
import Conversation, {
  ConversationSchema,
} from "./whatsapp/conversation.model.ts";
import Message, { MessageSchema } from "./whatsapp/message.model.ts";
import Template, { TemplateSchema } from "./whatsapp/template.model.ts";

export {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
  Template,
  TemplateSchema,
};

export const schemas: Record<string, Schema<any>> = {
  conversations: ConversationSchema,
  messages: MessageSchema,
  templates: TemplateSchema,
  leads: Lead.schema,
  pipelines: Pipeline.schema,
  pipelineStages: PipelineStage.schema,
  automationRules: AutomationRule.schema,
  leadActivities: LeadActivity.schema,
  leadNotes: LeadNote.schema,
  communicationWorkflows: CommunicationWorkflow.schema,
};
