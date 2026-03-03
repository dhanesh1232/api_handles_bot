import type mongoose from "mongoose";

declare global {
  interface IConversation extends mongoose.Document {
    leadId?: mongoose.Types.ObjectId;
    channel: "whatsapp";
    phone: string;
    userName?: string;
    profilePicture?: string;
    lastMessage?: string;
    lastMessageId?: mongoose.Types.ObjectId;
    lastMessageStatus?: string;
    lastMessageSender: "admin" | "user";
    lastMessageType:
      | "text"
      | "image"
      | "document"
      | "template"
      | "video"
      | "audio";
    lastMessageAt?: Date;
    unreadCount: number;
    status: "open" | "closed";
    lastUserMessageAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  interface IMessageReaction {
    emoji: string;
    reactBy: string; // 'admin' or contact phone
  }

  interface IMessageTemplateData {
    name: string;
    language: string;
    headerType?: string;
    footer?: string;
    buttons?: any;
    variables?: string[];
  }

  interface IMessageStatusHistory {
    status: string;
    timestamp: Date;
  }

  interface IMessage extends mongoose.Document {
    conversationId: mongoose.Types.ObjectId;
    direction: "inbound" | "outbound";
    messageType: "text" | "image" | "document" | "template" | "video" | "audio";
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    caption?: string;
    whatsappMessageId?: string;
    sentBy: string; // 'admin', user_id, or system
    status: "queued" | "sent" | "delivered" | "read" | "failed";
    error?: string;
    isStarred: boolean;
    replyTo?: mongoose.Types.ObjectId;
    replyToWhatsappId?: string;
    reactions: IMessageReaction[];
    statusHistory: IMessageStatusHistory[];
    templateData?: IMessageTemplateData;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
  }

  interface ITemplateButton {
    type: "URL" | "PHONE_NUMBER" | "QUICK_REPLY";
    text?: string;
    url?: string;
    phoneNumber?: string;
  }

  export type MappingSource =
    | "crm"
    | "static"
    | "computed"
    | "system"
    | "manual"
    | "dynamic";
  export type OnEmptyVariable = "skip_send" | "use_fallback" | "send_anyway";
  export type MappingStatus = "unmapped" | "partial" | "complete" | "outdated";
  export type TemplateStatus =
    | "APPROVED"
    | "REJECTED"
    | "PENDING"
    | "PAUSED"
    | "DISABLED";
  export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

  interface IVariableMapping {
    position: number;
    label: string;
    source: MappingSource;
    collection?: string;
    field?: string;
    staticValue?: string;
    formula?: string;
    fallback?: string;
    required?: boolean;

    // Component awareness
    componentType?: "HEADER" | "BODY" | "FOOTER" | "BUTTON";
    componentIndex?: number; // Only for buttons
    originalIndex?: number; // The {{n}} inside that component
  }

  interface ITemplate extends mongoose.Document {
    name: string;
    language: string;
    channel: "whatsapp" | "email";
    status: string;
    headerType?: "NONE" | "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT";
    bodyText: string;
    subject?: string;
    attachments?: string[];
    variablesCount?: number;
    footerText?: string;
    buttons?: ITemplateButton[];
    components?: any[];

    // New Fields for Template Configuration
    templateId?: string;
    category?: TemplateCategory;
    headerText?: string;
    variablePositions: number[];
    variableMapping: IVariableMapping[];
    onEmptyVariable: OnEmptyVariable;
    mappingStatus: MappingStatus;
    lastSyncedAt?: Date;
    lastMappingUpdatedAt?: Date;
    isActive: boolean;

    createdAt: Date;
    updatedAt: Date;
  }

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
    | "product"
    | "service"
    | "doctor"
    | "webhook"
    | "manual"
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
    | "action_required"
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
    | "meeting_created"
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
    | "create_meeting"
    | "send_callback"
    | "update_lead"
    | "create_note";

  interface IAutomationAction {
    type: AutomationActionType;
    delayMinutes: number; // 0 = instant
    delayType?: "after_trigger" | "before_event" | "at_event" | "after_event";
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
  interface IMeeting extends mongoose.Document {
    clientCode: string;
    leadId: mongoose.Types.ObjectId;
    participantName: string;
    participantPhone: string;
    participantEmails: string[];
    startTime: Date;
    endTime: Date;
    duration: number;
    meetingMode: "online" | "offline";
    meetLink?: string | null;
    meetCode?: string | null;
    eventId?: string | null;
    type: "free" | "paid";
    amount: number;
    paymentStatus: "pending" | "paid" | "na";
    status: "scheduled" | "completed" | "cancelled" | "pending";
    reminders: {
      actionId: string;
      type: "send_whatsapp" | "send_email";
      fireTime: Date;
      status: "pending" | "sent" | "failed";
      error?: string;
      sentAt?: Date;
    }[];
    metadata: {
      refs: Record<string, mongoose.Types.ObjectId | string | null>;
      extra: Record<string, any>;
    };
    createdAt: Date;
    updatedAt: Date;
  }

  type NotificationType = "action_required" | "alert" | "info";
  type NotificationStatus = "unread" | "resolved" | "dismissed";

  interface INotification extends mongoose.Document {
    clientCode: string;
    title: string;
    message: string;
    type: NotificationType;
    status: NotificationStatus;
    actionData: {
      actionConfig?: any;
      leadId?: mongoose.Types.ObjectId;
      contextSnapshot?: Record<string, any>;
      [key: string]: any;
    };
    createdAt: Date;
    updatedAt: Date;
  }
}

export {};
