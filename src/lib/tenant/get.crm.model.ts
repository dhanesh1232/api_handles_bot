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

import mongoose, { type Model } from "mongoose";
import { AutomationRuleSchema } from "@/model/saas/crm/automationRule.model";
import { LeadSchema } from "@/model/saas/crm/lead.model";
import { LeadActivitySchema } from "@/model/saas/crm/leadActivity.model";
import { LeadNoteSchema } from "@/model/saas/crm/leadNote.model";
import { NotificationSchema } from "@/model/saas/crm/notification.model";
import { PipelineSchema } from "@/model/saas/crm/pipeline.model";
import { PipelineStageSchema } from "@/model/saas/crm/pipelineStage.model";
import { SegmentSchema, type ISegment } from "@/model/saas/crm/segment.model";
import {
  callbackLogSchema,
  type ICallbackLog,
} from "@/model/saas/event/callbackLog.model";
import {
  eventLogSchema,
  type IEventLog,
} from "@/model/saas/event/eventLog.model";
import {
  ConversationSchema,
  MessageSchema,
  CustomEventDefSchema,
} from "@/model/saas/tenant.schemas";
import { MeetingSchema } from "@/model/saas/meet/meeting.model";
import { getTenantConnection } from "@lib/connectionManager";
import { Client } from "@/model/clients/client";

// ─── Model registry per connection ────────────────────────────────────────────
// Each tenant Connection caches its own compiled models.
// We reuse them on subsequent calls — no re-compilation overhead.

function getOrCreate<T>(
  conn: mongoose.Connection,
  name: string,
  schema: mongoose.Schema<T>,
): Model<T> {
  if (conn.models[name]) return conn.models[name] as Model<T>;
  return conn.model<T>(name, schema);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CrmModels {
  Lead: Model<ILead>;
  Pipeline: Model<IPipeline>;
  PipelineStage: Model<IPipelineStage>;
  LeadActivity: Model<ILeadActivity>;
  LeadNote: Model<ILeadNote>;
  AutomationRule: Model<IAutomationRule>;
  Meeting: Model<IMeeting>;
  Notification: Model<INotification>;
  EventLog: Model<IEventLog>;
  CallbackLog: Model<ICallbackLog>;
  CustomEventDef: Model<ICustomEventDef>;
  Segment: Model<ISegment>;
  Conversation: Model<IConversation>;
  Message: Model<IMessage>;
}

/**
 * Returns all CRM models bound to the client's own DB connection.
 * The connection is cached — subsequent calls for the same clientCode are free.
 */
export async function getCrmModels(clientCode: string): Promise<CrmModels> {
  const conn = await getTenantConnection(clientCode);

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
  };
}

/**
 * Returns basic configuration for the client (name, etc.)
 */
export async function getClientConfig(clientCode: string) {
  const client = await Client.findOne({ clientCode: clientCode.toUpperCase() });
  return {
    name: client?.name || "Our Business",
    businessEmail: client?.business?.email,
    businessPhone: client?.business?.phone,
  };
}
