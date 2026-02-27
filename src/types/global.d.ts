import type mongoose from "mongoose";

declare global {
  type LeadSource =
    | "website"
    | "whatsapp"
    | "instagram"
    | "facebook"
    | "referral"
    | "cold_outreach"
    | "phone"
    | "email"
    | "walk_in"
    | "other";

  type LeadStatus = "open" | "won" | "lost" | "archived";

  interface LeadListFilters {
    status?: LeadStatus;
    pipelineId?: string;
    stageId?: string;
    source?: LeadSource;
    assignedTo?: string;
    tags?: string[];
    minScore?: number;
    search?: string;
    appointmentId?: string;
    bookingId?: string;
    orderId?: string;
    meetingId?: string;
  }

  interface LeadListOptions {
    page?: number;
    limit?: number;
    sortBy?:
      | "score"
      | "createdAt"
      | "updatedAt"
      | "dealValue"
      | "lastContactedAt";
    sortDir?: "asc" | "desc";
  }

  interface ILeadScore {
    total: number;
    recency: number;
    engagement: number;
    stageDepth: number;
    dealSize: number;
    sourceQuality: number;
    updatedAt: Date;
  }

  interface ILeadMetadataRefs {
    appointmentId?: mongoose.Types.ObjectId;
    bookingId?: mongoose.Types.ObjectId;
    orderId?: mongoose.Types.ObjectId;
    productId?: mongoose.Types.ObjectId;
    serviceId?: mongoose.Types.ObjectId;
    meetingId?: mongoose.Types.ObjectId;
    [key: string]: mongoose.Types.ObjectId | undefined;
  }

  interface ILeadMetadataExtra {
    [key: string]: string | number | boolean | null;
  }

  interface ILeadMetadata {
    refs: ILeadMetadataRefs;
    extra: ILeadMetadataExtra;
  }

  interface ILead extends mongoose.Document {
    clientCode: string;
    firstName: string;
    lastName?: string;
    email?: string;
    phone: string;
    pipelineId: mongoose.Types.ObjectId;
    stageId: mongoose.Types.ObjectId;
    status: LeadStatus;
    dealValue?: number;
    currency: string;
    dealTitle?: string;
    source: LeadSource;
    assignedTo?: string;
    tags: string[];
    metadata: ILeadMetadata;
    score: ILeadScore;
    lastContactedAt?: Date;
    convertedAt?: Date;
    isArchived: boolean;
    createdAt: Date;
    updatedAt: Date;
    fullName?: string;
  }

  interface IPipeline extends mongoose.Document {
    clientCode: string;
    name: string;
    description?: string;
    order: number;
    isDefault: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  type AutoActionType =
    | "send_whatsapp"
    | "send_email"
    | "assign_to"
    | "create_meeting"
    | "add_tag"
    | "webhook_notify";

  interface IAutoAction {
    type: AutoActionType;
    delayMinutes: number;
    config: Record<string, unknown>;
  }

  interface IPipelineStage extends mongoose.Document {
    clientCode: string;
    pipelineId: mongoose.Types.ObjectId;
    name: string;
    order: number;
    color: string;
    isDefault: boolean;
    isWon: boolean;
    isLost: boolean;
    probability: number;
    autoActions: IAutoAction[];
    createdAt: Date;
    updatedAt: Date;
  }

  type ActivityType =
    | "whatsapp_sent"
    | "whatsapp_received"
    | "whatsapp_delivered"
    | "whatsapp_read"
    | "email_sent"
    | "email_opened"
    | "email_clicked"
    | "email_bounced"
    | "call_logged"
    | "meeting_created"
    | "meeting_completed"
    | "meeting_cancelled"
    | "stage_change"
    | "deal_won"
    | "deal_lost"
    | "tag_added"
    | "tag_removed"
    | "note_added"
    | "score_updated"
    | "lead_created"
    | "lead_assigned"
    | "automation_triggered"
    | "system";

  interface ILeadActivity extends mongoose.Document {
    clientCode: string;
    leadId: mongoose.Types.ObjectId;
    type: ActivityType;
    title: string;
    body?: string;
    metadata: Record<string, unknown>;
    performedBy: string;
    createdAt: Date;
  }

  interface ILeadNote extends mongoose.Document {
    clientCode: string;
    leadId: mongoose.Types.ObjectId;
    content: string;
    isPinned: boolean;
    createdBy: string;
    updatedAt: Date;
    createdAt: Date;
  }

  type AutomationTrigger =
    | "stage_enter"
    | "stage_exit"
    | "lead_created"
    | "deal_won"
    | "deal_lost"
    | "score_above"
    | "score_below"
    | "no_contact"
    | "tag_added"
    | "tag_removed"
    | "appointment_confirmed"
    | "appointment_cancelled"
    | "appointment_reminder"
    | "product_purchased"
    | "service_enrolled"
    | "payment_captured"
    | "form_submitted";

  type AutomationActionType =
    | "send_whatsapp"
    | "send_email"
    | "move_stage"
    | "move_pipeline"
    | "assign_to"
    | "add_tag"
    | "remove_tag"
    | "webhook_notify"
    | "create_meeting";

  interface IAutomationAction {
    type: AutomationActionType;
    delayMinutes: number; // 0 = instant
    config: Record<string, unknown>; // templateName, stageId, assignTo, tag, etc.
  }

  interface IAutomationCondition {
    field: string;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
    value: any;
  }

  interface IAutomationRule extends mongoose.Document {
    clientCode: string;
    name: string;
    trigger: AutomationTrigger;
    triggerConfig: {
      stageId?: mongoose.Types.ObjectId; // for stage_enter / stage_exit
      pipelineId?: mongoose.Types.ObjectId;
      scoreThreshold?: number; // for score_above / score_below
      tagName?: string; // for tag_added / tag_removed
      inactiveDays?: number; // for no_contact
    };
    condition?: IAutomationCondition; // optional extra condition on the lead
    actions: IAutomationAction[];
    steps?: any[];
    isSequence?: boolean;
    totalEnrollments?: number;
    activeEnrollments?: number;
    completedEnrollments?: number;
    isActive: boolean;
    executionCount: number; // how many times this rule has fired
    lastExecutedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }
  export type MappingSource =
    | "crm"
    | "static"
    | "computed"
    | "system"
    | "manual";
  export type OnEmptyVariable = "skip_send" | "use_fallback" | "send_anyway";
  export type MappingStatus = "unmapped" | "partial" | "complete" | "outdated";
  export type TemplateStatus =
    | "APPROVED"
    | "REJECTED"
    | "PENDING"
    | "PAUSED"
    | "DISABLED";
  export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

  export interface IVariableMapping {
    position: number;
    label: string;
    source: MappingSource;
    field?: string;
    staticValue?: string;
    formula?: string;
    fallback?: string;
    required?: boolean;
  }

  export interface ITemplateConfigFields {
    templateId?: string;
    category?: TemplateCategory;
    headerText?: string;
    variablePositions: number[];
    variableMapping: IVariableMapping[];
    onEmptyVariable: OnEmptyVariable;
    mappingStatus: MappingStatus;
    lastSyncedAt?: Date;
    lastMappingUpdatedAt?: Date;
    isActive?: boolean;
  }

  export interface ResolvedVariables {
    variables: string[];
  }

  export interface SyncResult {
    synced: number;
    updated: number;
    outdated: string[];
    new: string[];
  }
}

export {};
