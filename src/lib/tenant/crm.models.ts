import { getTenantConnection } from "@lib/connectionManager";
import mongoose, { type Connection, type Schema } from "mongoose";
import { Client } from "@/model/clients/client";
import AutomationRuleSchema from "@/model/saas/crm/automationRule.model";
import EmailCampaignSchema from "@/model/saas/crm/emailCampaign.model";
import LeadSchema from "@/model/saas/crm/lead.model";
import LeadActivitySchema from "@/model/saas/crm/leadActivity.model";
import LeadNoteSchema from "@/model/saas/crm/leadNote.model";
import NotificationSchema from "@/model/saas/crm/notification.model";
import PipelineSchema from "@/model/saas/crm/pipeline.model";
import PipelineStageSchema from "@/model/saas/crm/pipelineStage.model";
import { ScoringConfigSchema } from "@/model/saas/crm/scoringConfig.model";
import SegmentSchema from "@/model/saas/crm/segment.model";
import { SequenceEnrollmentSchema } from "@/model/saas/crm/sequenceEnrollment.model";
import { callbackLogSchema } from "@/model/saas/event/callbackLog.model";
import CustomEventDefSchema from "@/model/saas/event/customEventDef.model";
import { eventLogSchema } from "@/model/saas/event/eventLog.model";
import { MeetingSchema } from "@/model/saas/meet/meeting.model";
import BroadcastSchema from "@/model/saas/whatsapp/broadcast.model";
import ConversationSchema from "@/model/saas/whatsapp/conversation.model";
import MessageSchema from "@/model/saas/whatsapp/message.model";
import TemplateSchema from "@/model/saas/whatsapp/template.model";

/**
 * @module Lib/Tenant/CrmModels
 * @responsibility Orchestrates dynamic Model-to-Connection binding for multi-tenant isolation.
 *
 * **WORKING PROCESS:**
 * 1. Schema Registration: All CRM-related schemas are imported and registered in `tenantModelConfig`.
 * 2. Model Injection: `getTenantModels` iterates through the config and binds each schema to a provided Mongoose connection.
 * 3. Connection Retrieval: `getCrmModels` uses the `connectionManager` to get or create a tenant-specific DB connection.
 * 4. Model Retrieval: Returns a cohesive object (`CrmModels`) containing all bound models (Lead, Pipeline, etc.).
 */
export {
  AutomationRuleSchema,
  BroadcastSchema,
  ConversationSchema,
  CustomEventDefSchema,
  callbackLogSchema,
  eventLogSchema,
  LeadActivitySchema,
  LeadNoteSchema,
  LeadSchema,
  MeetingSchema,
  MessageSchema,
  NotificationSchema,
  PipelineSchema,
  PipelineStageSchema,
  ScoringConfigSchema,
  SegmentSchema,
  SequenceEnrollmentSchema,
  TemplateSchema,
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
  EmailCampaign: { name: "EmailCampaign", schema: EmailCampaignSchema },
  SequenceEnrollment: {
    name: "SequenceEnrollment",
    schema: SequenceEnrollmentSchema,
  },
  ScoringConfig: { name: "ScoringConfig", schema: ScoringConfigSchema },
};

// function getOrCreate... (keeping common lines for context or just deleting the block)

/**
 * Internal helper to safely register a model on a connection if it doesn't already exist.
 */
function getOrCreate<T>(
  conn: mongoose.Connection,
  name: string,
  schema: mongoose.Schema<T>,
): mongoose.Model<T> {
  if (conn.models[name]) return conn.models[name] as mongoose.Model<T>;
  return conn.model<T>(name, schema);
}

/**
 * Binds all registered schemas to a specific Mongoose Connection.
 *
 * **WORKING PROCESS:**
 * 1. Registry Traversal: Loops through `tenantModelConfig`.
 * 2. Model Creation: Uses `getOrCreate` to ensure models are only defined once per connection.
 * 3. Aggregation: Returns the full set of models for immediate use.
 *
 * @param conn - The active Mongoose connection for a specific tenant.
 */
export function getTenantModels(conn: Connection): CrmModels {
  const models: any = { conn };

  for (const [key, config] of Object.entries(tenantModelConfig)) {
    models[key] = getOrCreate(conn, config.name, config.schema);
  }

  return models as CrmModels;
}

/**
 * Entry point for any CRM data operation. Resolves the tenant's connection and returns their models.
 *
 * **WORKING PROCESS:**
 * 1. Normalization: Converts `clientCode` to uppercase.
 * 2. Connection Lookup: Asks `getTenantConnection` for a shared or dedicated connection (cached).
 * 3. Integration: Passes the connection to `getTenantModels` for model binding.
 *
 * **EDGE CASES:**
 * - Invalid clientCode: If the connection cannot be established, this throws an error, preventing data cross-pollution.
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
