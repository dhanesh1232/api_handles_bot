/**
 * @host get.crm.model.ts
 *
 * Returns all 6 CRM Mongoose models bound to the client's tenant DB connection.
 * Every CRM service function should call this helper at the top:
 *
 * const { Lead, Pipeline, ... } = await getCrmModels(clientCode);
 *
 * All subsequent reads/writes will go to that client's own MongoDB, not the
 * central services DB.
 */

import mongoose from "mongoose";
import { AutomationRuleSchema } from "@/model/saas/crm/automationRule.model";
import { LeadSchema } from "@/model/saas/crm/lead.model";
import { LeadActivitySchema } from "@/model/saas/crm/leadActivity.model";
import { LeadNoteSchema } from "@/model/saas/crm/leadNote.model";
import { NotificationSchema } from "@/model/saas/crm/notification.model";
import { PipelineSchema } from "@/model/saas/crm/pipeline.model";
import { PipelineStageSchema } from "@/model/saas/crm/pipelineStage.model";
import { SegmentSchema } from "@/model/saas/crm/segment.model";
import { callbackLogSchema } from "@/model/saas/event/callbackLog.model";
import { eventLogSchema } from "@/model/saas/event/eventLog.model";
import {
  ConversationSchema,
  MessageSchema,
  CustomEventDefSchema,
  SequenceEnrollmentSchema,
  TemplateSchema,
  BroadcastSchema,
  ScoringConfigSchema,
} from "@/model/saas/tenant.schemas";
import { MeetingSchema } from "@/model/saas/meet/meeting.model";
import { getTenantConnection } from "@lib/connectionManager";
import { Client } from "@/model/clients/client";

// --- Models registry per connection ---
// CrmModels interface is now defined globally in src/types/global.d.ts

function getOrCreate<T>(
  conn: mongoose.Connection,
  name: string,
  schema: mongoose.Schema<T>,
): mongoose.Model<T> {
  if (conn.models[name]) return conn.models[name] as mongoose.Model<T>;
  return conn.model<T>(name, schema);
}

/**
 * Returns all CRM models bound to the client's own DB connection.
 * The connection is cached — subsequent calls for the same clientCode are free.
 */
export async function getCrmModels(clientCode: string): Promise<CrmModels> {
  const code = clientCode.toUpperCase();
  const conn = await getTenantConnection(code);

  return {
    Lead: getOrCreate<ILead>(conn, "Lead", LeadSchema),
    Pipeline: getOrCreate<IPipeline>(conn, "Pipeline", PipelineSchema),
    PipelineStage: getOrCreate<IPipelineStage>(
      conn,
      "PipelineStage",
      PipelineStageSchema,
    ),
    LeadActivity: getOrCreate<ILeadActivity>(
      conn,
      "LeadActivity",
      LeadActivitySchema,
    ),
    LeadNote: getOrCreate<ILeadNote>(conn, "LeadNote", LeadNoteSchema),
    AutomationRule: getOrCreate<IAutomationRule>(
      conn,
      "AutomationRule",
      AutomationRuleSchema,
    ),
    Meeting: getOrCreate<IMeeting>(conn, "Meeting", MeetingSchema),
    Notification: getOrCreate<INotification>(
      conn,
      "Notification",
      NotificationSchema,
    ),
    EventLog: getOrCreate<IEventLog>(conn, "EventLog", eventLogSchema),
    CallbackLog: getOrCreate<ICallbackLog>(
      conn,
      "CallbackLog",
      callbackLogSchema,
    ),
    CustomEventDef: getOrCreate<ICustomEventDef>(
      conn,
      "CustomEventDef",
      CustomEventDefSchema,
    ),
    Segment: getOrCreate<ISegment>(conn, "Segment", SegmentSchema),
    Conversation: getOrCreate<IConversation>(
      conn,
      "Conversation",
      ConversationSchema,
    ),
    Message: getOrCreate<IMessage>(conn, "Message", MessageSchema),
    Template: getOrCreate<ITemplate>(conn, "Template", TemplateSchema),
    Broadcast: getOrCreate<IBroadcast>(conn, "Broadcast", BroadcastSchema),
    SequenceEnrollment: getOrCreate<ISequenceEnrollment>(
      conn,
      "SequenceEnrollment",
      SequenceEnrollmentSchema,
    ),
    ScoringConfig: getOrCreate<any>(conn, "ScoringConfig", ScoringConfigSchema),
    conn,
  };
}

/**
 * Returns basic configuration for the client (name, etc.)
 */
export async function getClientConfig(clientCode: string) {
  const code = clientCode.toUpperCase();
  const client = await Client.findOne({ clientCode: code });
  return {
    name: client?.name || "Our Business",
    businessEmail: client?.business?.email,
    businessPhone: client?.business?.phone,
  };
}
