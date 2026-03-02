import type { Schema } from "mongoose";
import AutomationRuleSchema from "./crm/automationRule.model.ts";
import LeadSchema from "./crm/lead.model.ts";
import LeadActivitySchema from "./crm/leadActivity.model.ts";
import LeadNoteSchema from "./crm/leadNote.model.ts";
import NotificationSchema from "./crm/notification.model.ts";
import PipelineSchema from "./crm/pipeline.model.ts";
import PipelineStageSchema from "./crm/pipelineStage.model.ts";
import { ScoringConfigSchema } from "./crm/scoringConfig.model.ts";
import { SequenceEnrollmentSchema } from "./crm/sequenceEnrollment.model.ts";
import { MeetingSchema } from "./meet/meeting.model.ts";
import BroadcastSchema from "./whatsapp/broadcast.model.ts";
import ConversationSchema from "./whatsapp/conversation.model.ts";
import MessageSchema from "./whatsapp/message.model.ts";
import TemplateSchema from "./whatsapp/template.model.ts";

export {
  AutomationRuleSchema,
  BroadcastSchema,
  ConversationSchema,
  LeadActivitySchema,
  LeadNoteSchema,
  LeadSchema,
  MeetingSchema,
  MessageSchema,
  NotificationSchema,
  PipelineSchema,
  PipelineStageSchema,
  ScoringConfigSchema,
  SequenceEnrollmentSchema,
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
  notifications: NotificationSchema,
  broadcasts: BroadcastSchema,
  sequenceEnrollments: SequenceEnrollmentSchema,
  scoringConfigs: ScoringConfigSchema,
  meetings: MeetingSchema,
};
