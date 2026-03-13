import mongoose, { type Connection, type Schema } from "mongoose";
import AutomationRuleSchema from "@/model/saas/crm/automationRule.model";
import LeadSchema from "@/model/saas/crm/lead.model";
import LeadActivitySchema from "@/model/saas/crm/leadActivity.model";
import LeadNoteSchema from "@/model/saas/crm/leadNote.model";
import NotificationSchema from "@/model/saas/crm/notification.model";
import PipelineSchema from "@/model/saas/crm/pipeline.model";
import PipelineStageSchema from "@/model/saas/crm/pipelineStage.model";
import { ScoringConfigSchema } from "@/model/saas/crm/scoringConfig.model";
import { SequenceEnrollmentSchema } from "@/model/saas/crm/sequenceEnrollment.model";
import { MeetingSchema } from "@/model/saas/meet/meeting.model";
import BroadcastSchema from "@/model/saas/whatsapp/broadcast.model";
import ConversationSchema from "@/model/saas/whatsapp/conversation.model";
import MessageSchema from "@/model/saas/whatsapp/message.model";
import TemplateSchema from "@/model/saas/whatsapp/template.model";
import CustomEventDefSchema from "@/model/saas/event/customEventDef.model";
import SegmentSchema from "@/model/saas/crm/segment.model";
import { eventLogSchema } from "@/model/saas/event/eventLog.model";
import { callbackLogSchema } from "@/model/saas/event/callbackLog.model";
import { getTenantConnection } from "@lib/connectionManager";
import { Client } from "@/model/clients/client";

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
  CustomEventDefSchema,
  SegmentSchema,
  eventLogSchema,
  callbackLogSchema,
};

/**
 * Registry of all tenant-specific models and their schemas.
 * Used by getTenantModels to dynamically bind models to tenant connections.
 */
export const tenantModelConfig: Record<
  string,
  { name: string; schema: Schema<any> }
> = {
  Lead: { name: "Lead", schema: LeadSchema },
  Pipeline: { name: "Pipeline", schema: PipelineSchema },
  PipelineStage: { name: "PipelineStage", schema: PipelineStageSchema },
  LeadActivity: { name: "LeadActivity", schema: LeadActivitySchema },
  LeadNote: { name: "LeadNote", schema: LeadNoteSchema },
  AutomationRule: { name: "AutomationRule", schema: AutomationRuleSchema },
  Meeting: { name: "Meeting", schema: MeetingSchema },
  Notification: { name: "Notification", schema: NotificationSchema },
  EventLog: { name: "EventLog", schema: eventLogSchema },
  CallbackLog: { name: "CallbackLog", schema: callbackLogSchema },
  CustomEventDef: { name: "CustomEventDef", schema: CustomEventDefSchema },
  Segment: { name: "Segment", schema: SegmentSchema },
  Conversation: { name: "Conversation", schema: ConversationSchema },
  Message: { name: "Message", schema: MessageSchema },
  Template: { name: "Template", schema: TemplateSchema },
  Broadcast: { name: "Broadcast", schema: BroadcastSchema },
  SequenceEnrollment: {
    name: "SequenceEnrollment",
    schema: SequenceEnrollmentSchema,
  },
  ScoringConfig: { name: "ScoringConfig", schema: ScoringConfigSchema },
};

// function getOrCreate... (keeping common lines for context or just deleting the block)

function getOrCreate<T>(
  conn: mongoose.Connection,
  name: string,
  schema: mongoose.Schema<T>,
): mongoose.Model<T> {
  if (conn.models[name]) return conn.models[name] as mongoose.Model<T>;
  return conn.model<T>(name, schema);
}

/**
 * Returns all CRM models bound to a specific tenant connection.
 */
export function getTenantModels(conn: Connection): CrmModels {
  const models: any = { conn };

  for (const [key, config] of Object.entries(tenantModelConfig)) {
    models[key] = getOrCreate(conn, config.name, config.schema);
  }

  return models as CrmModels;
}

/**
 * Returns all CRM models bound to the client's own DB connection.
 * The connection is cached — subsequent calls for the same clientCode are free.
 */
export async function getCrmModels(clientCode: string): Promise<CrmModels> {
  const code = clientCode.toUpperCase();
  const conn = await getTenantConnection(code);
  return getTenantModels(conn);
}

/**
 * Returns basic configuration for the client (name, etc.)
 */
export async function getClientConfig(clientCode: string) {
  const code = clientCode.toUpperCase();
  return await Client.findOne({ clientCode: code }).lean();
}
