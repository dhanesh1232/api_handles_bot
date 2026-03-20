import type mongoose from "mongoose";
import type { Request } from "express";
declare global {
  interface SaasRequest extends Request {
    clientCode: string;
    user?: any;
  }

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
      | "audio"
      | "button"
      | "interactive"
      | "location"
      | "contacts"
      | "sticker"
      | "reaction";
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
    headerFilename?: string;
  }

  interface IMessageStatusHistory {
    status: string;
    timestamp: Date;
  }

  interface IMessage extends mongoose.Document {
    conversationId: mongoose.Types.ObjectId;
    direction: "inbound" | "outbound";
    messageType:
      | "text"
      | "image"
      | "document"
      | "template"
      | "video"
      | "audio"
      | "button"
      | "interactive"
      | "location"
      | "contacts"
      | "sticker"
      | "reaction";
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    filename?: string;
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

  type MappingSource =
    | "crm"
    | "static"
    | "computed"
    | "system"
    | "manual"
    | "dynamic"
    | "trigger";
  type OnEmptyVariable = "skip_send" | "use_fallback" | "send_anyway";
  type MappingStatus = "unmapped" | "partial" | "complete" | "outdated";
  type TemplateStatus =
    | "APPROVED"
    | "REJECTED"
    | "PENDING"
    | "PAUSED"
    | "DISABLED";
  type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

  type TransformType =
    | "none"
    | "uppercase"
    | "lowercase"
    | "titlecase"
    | "date"
    | "currency"
    | "number";
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
    componentType?: "HEADER" | "BODY" | "FOOTER" | "BUTTON" | "SUBJECT";
    componentIndex?: number; // Only for buttons

    originalIndex?: number; // The {{n}} inside that component
    transform?: TransformType;
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
    contentType?: "text" | "html";
    mappingStatus: MappingStatus;
    lastSyncedAt?: Date;
    lastMappingUpdatedAt?: Date;
    isActive: boolean;

    socialLinks?: {
      platform: "facebook" | "twitter" | "instagram" | "linkedin";
      url: string;
      active: boolean;
    }[];

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
    startDate?: string;
    endDate?: string;
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
    aiSummary?: {
      text: string;
      updatedAt: Date;
    };
    dynamicFields?: Record<string, any>;

    enteredStageAt: Date;
    stageHistory: {
      stageId: mongoose.Types.ObjectId;
      enteredAt: Date;
      leftAt?: Date;
      durationMs?: number;
    }[];
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

  interface CreatePipelineInput {
    name: string;
    description?: string;
    isDefault?: boolean;
    stages: Array<{
      name: string;
      color?: string;
      probability?: number;
      isDefault?: boolean;
      isWon?: boolean;
      isLost?: boolean;
    }>;
  }

  interface UpdateStageOrderInput {
    stageId: string;
    newOrder: number;
  }

  interface ForecastRow {
    stageId: string;
    stageName: string;
    probability: number;
    totalValue: number;
    expectedRevenue: number;
    leadCount: number;
  }

  interface BoardColumn {
    stage: IPipelineStage;
    leadCount: number;
    totalValue: number;
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

  interface IStepCondition {
    field?: string;
    operator?:
      | "equals"
      | "not_equals"
      | "greater_than"
      | "less_than"
      | "contains"
      | "exists"
      | "not_exists";
    value?: any;
  }

  interface IStepExitCondition {
    field?: string;
    operator?: string;
    value?: any;
  }

  interface ISequenceStep {
    stepNumber: number;
    name?: string;
    delayMinutes?: number;
    delayReference?: "trigger_time" | "previous_step";
    action: {
      type:
        | "send_whatsapp"
        | "send_email"
        | "generate_meet"
        | "callback_client"
        | "update_lead"
        | "tag_lead"
        | "move_pipeline_stage"
        | "http_webhook";
      config: Record<string, any>;
    };
    conditions?: IStepCondition[];
    exitSequenceIf?: IStepExitCondition[];
    onFailure?: "continue" | "stop" | "retry";
  }

  interface IAutomationRule extends mongoose.Document {
    clientCode: string;
    name: string;
    trigger: string;
    triggerConfig: {
      stageId?: mongoose.Types.ObjectId; // for stage_enter / stage_exit
      pipelineId?: mongoose.Types.ObjectId;
      scoreThreshold?: number; // for score_above / score_below
      tagName?: string; // for tag_added / tag_removed
      inactiveDays?: number; // for no_contact
      includeSources?: string[];
      excludeSources?: string[];
    };
    condition?: IAutomationCondition; // legacy
    conditions: IAutomationCondition[]; // new
    conditionLogic: "AND" | "OR";
    actions: IAutomationAction[];
    steps?: ISequenceStep[];
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

  interface AutomationContext {
    trigger: string;
    aliases?: string[];
    lead: ILead;
    stageId?: string;
    tagName?: string;
    score?: number;
    source?: string;
    /** Extra key-value pairs from external events (e.g. { name: "Ravi", time: "3pm" }) */
    variables?: Record<string, string>;
    meetingId?: string;
    data?: any;
    event?: any;
  }

  interface ITemplateConfigFields {
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

  interface ResolvedVariables {
    variables: string[];
  }

  interface SyncResult {
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
      status: "pending" | "sent" | "failed" | "cancelled";
      error?: string;
      sentAt?: Date;
      rescheduled?: boolean;
    }[];
    rescheduledAt?: Date | null;
    metadata: {
      refs: Record<string, any>; // supports single IDs or arrays of IDs
      extra: Record<string, any>;
    };
    createdAt: Date;
    updatedAt: Date;
  }

  interface CreateMeetingInput {
    leadId: string;
    appointmentId?: string;
    doctorId?: string;
    participantName: string;
    participantPhone: string;
    participantEmails?: string[];
    startTime: string | Date;
    endTime: string | Date;
    duration: number;
    meetingMode: "online" | "offline";
    type: "free" | "paid";
    amount?: number;
    metadata?: {
      refs?: Record<string, string | undefined>;
      extra?: Record<string, any>;
    };
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

  interface ICustomEventDef extends mongoose.Document {
    clientCode: string;
    name: string;
    displayName: string;
    description?: string;
    payloadSchema?: Record<string, any>;
    isActive: boolean;
    isSystem: boolean;
    mapsTo?: string;
    pipelineId?: string;
    stageId?: string;
    defaultSource?: string;
    createdAt: Date;
    updatedAt: Date;
  }

  interface ISegment extends mongoose.Document {
    clientCode: string;
    name: string;
    description?: string;
    color: string;
    rules: {
      field: string;
      operator: string;
      value: any;
    }[];
    logic: "AND" | "OR";
    memberCount: number;
    lastCalculatedAt: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  // --- Client & Tenant Models ---
  interface IClient extends mongoose.Document {
    name: string;
    description?: string;
    clientCode: string;
    status: "active" | "inactive" | "pending";
    industry?: string;
    contactPerson?: {
      name: string;
      email: string;
      phone?: string;
    };
    branding?: {
      logo?: string;
      primaryColor?: string;
      secondaryColor?: string;
    };
    services: string[];
    createdAt: Date;
    updatedAt: Date;
  }

  interface IClientDataSource extends mongoose.Document {
    clientCode: string;
    type: "google-maps" | "apify" | "custom";
    config: Record<string, any>;
    lastSyncAt?: Date;
    status: "active" | "inactive" | "error";
    createdAt: Date;
    updatedAt: Date;
  }

  interface IClientServiceConfig extends mongoose.Document {
    clientCode: string;
    serviceId: string;
    isEnabled: boolean;
    config: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
  }

  interface IClientSecrets extends mongoose.Document {
    clientCode: string;
    whatsappToken?: string;
    whatsappPhoneNumberId?: string;
    whatsappVerifyToken?: string;
    googleCalendarToken?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    r2AccessKey?: string;
    r2SecretKey?: string;
    r2BucketName?: string;
    r2PublicUrl?: string;
    lastUpdated: Date;
  }

  // --- External Content & CMS ---
  interface IBlog extends mongoose.Document {
    title: string;
    slug: string;
    content: string;
    author: string;
    tags: string[];
    thumbnail?: string;
    status: "draft" | "published";
    publishedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  // --- Infrastructure & Lib Types ---
  interface FieldDefinition {
    key: string;
    label: string;
    type: "string" | "number" | "date" | "boolean" | "enum" | "objectid";
    source: MappingSource;
    required?: boolean;
    options?: { label: string; value: any }[];
    fallbackValue?: any;
    transform?: TransformType;
    icon?: string;
    category?: string;
  }

  interface GoogleMeetConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken?: string;
  }

  interface MeetingInput {
    summary: string;
    description?: string;
    start: string;
    end: string;
    attendees?: string[];
  }

  interface SendMailInput {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }

  interface MailConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    fromName: string;
    fromEmail: string;
    secure?: boolean;
  }

  interface CallbackPayload {
    clientCode: string;
    trigger: string;
    data: any;
    timestamp: Date;
  }

  interface StorageOptions {
    region?: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket?: string;
    bucketName: string;
    publicDomain?: string;
  }

  interface UploadResult {
    url: string;
    key: string;
    bucket: string;
    size: number;
    mimeType: string;
  }

  interface ListResult {
    key: string;
    url: string;
    size: number;
    lastModified?: Date;
    mimeType?: string;
  }

  interface WhatsAppResponse {
    success: boolean;
    messageId?: string;
    data?: any;
    error?: any;
  }

  // --- Meta / WhatsApp Integration ---
  interface MetaTextPayload {
    messaging_product: "whatsapp";
    to: string;
    type: "text";
    text: { body: string };
  }

  interface MetaTemplatePayload {
    messaging_product: "whatsapp";
    to: string;
    type: "template";
    template: {
      name: string;
      language: { code: string };
      components?: MetaTemplateComponent[];
    };
  }

  interface MetaTemplateComponent {
    type: "body" | "header" | "button";
    parameters: Array<{ type: "text"; text: string }>;
  }

  interface MetaMediaPayload {
    messaging_product: "whatsapp";
    to: string;
    type: "image" | "video" | "document" | "audio";
    [key: string]: unknown;
  }

  interface MetaReactionPayload {
    messaging_product: "whatsapp";
    to: string;
    type: "reaction";
    reaction: { message_id: string; emoji: string };
  }

  interface MetaSendResult {
    messages: Array<{ id: string }>;
    contacts: Array<{ input: string; wa_id: string }>;
  }

  interface MetaTemplate {
    id: string;
    name: string;
    status: string;
    category: string;
    language: string;
    components: unknown[];
  }

  interface CacheEntry<T = any> {
    value: T;
    expiresAt: number;
  }

  interface CacheOptions {
    ttl?: number;
  }

  interface ICache {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
    del(key: string): Promise<void>;
    clear(): Promise<void>;
  }

  // --- Automation & Sequences ---
  interface ISequenceEnrollment extends mongoose.Document {
    ruleId: mongoose.Types.ObjectId;
    clientCode: string;
    phone: string;
    email?: string;
    trigger: string;
    leadId: mongoose.Types.ObjectId;
    eventData?: Record<string, any>;
    resolvedVariables?: Record<string, string>;
    currentStep: number;
    totalSteps: number;
    status: "active" | "completed" | "failed" | "exited" | "paused";
    stepResults: Array<{
      stepNumber: number;
      status: "completed" | "failed" | "skipped";
      executedAt: Date;
      result?: any;
      error?: string;
    }>;
    nextStepAt?: Date;
    completedAt?: Date;
    exitReason?: string;
    createdAt: Date;
    updatedAt: Date;
  }

  interface IScoringConfig extends mongoose.Document {
    clientCode: string;
    rules: {
      field: string;
      operator:
        | "exists"
        | "not_exists"
        | "equals"
        | "not_equals"
        | "greater_than"
        | "less_than"
        | "contains";
      value?: any;
      points: number;
      label: string;
    }[];
    hotThreshold: number;
    coldThreshold: number;
    recalculateOnTriggers: string[];
    createdAt: Date;
    updatedAt: Date;
  }

  // --- WhatsApp & Communication ---
  interface IBroadcast extends mongoose.Document {
    name: string;
    templateId: mongoose.Types.ObjectId;
    status:
      | "pending"
      | "processing"
      | "completed"
      | "failed"
      | "partially_failed";
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  // --- Service Leads Models ---
  interface IAttachment {
    fileUrl?: string;
    fileName?: string;
    uploadedAt?: Date;
  }

  interface IFollowUp {
    message: string;
    method: "call" | "whatsapp" | "email" | "sms" | "in-person" | "other";
    outcome?:
      | "connected"
      | "not-answered"
      | "interested"
      | "busy"
      | "not-interested"
      | "follow-up-scheduled"
      | "wrong-number"
      | "converted"
      | null;
    priority?: "low" | "normal" | "high" | "urgent";
    date?: Date;
    nextFollowUpDate?: Date | null;
    createdBy?: mongoose.Types.ObjectId | null;
    attachments?: IAttachment[];
  }

  interface IActivity {
    type?:
      | "created"
      | "status-changed"
      | "follow-up"
      | "note-added"
      | "assigned"
      | "proposal-sent"
      | "file-uploaded"
      | "price-quoted";
    message?: string;
    createdBy?: mongoose.Types.ObjectId | null;
    meta?: any;
    createdAt?: Date;
  }

  interface INote {
    text: string;
    createdBy?: mongoose.Types.ObjectId | null;
    visibility?: "internal" | "public";
    createdAt?: Date;
    updatedAt?: Date | null;
  }

  interface IServiceLead extends mongoose.Document {
    title: string;
    name?: string | null;
    leadScore?: number;
    rating?: number;
    reviewsCount?: number;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    countryCode?: string | null;
    website?: string | null;
    email?: string | null;
    phone?: string | null;
    categoryName?: string | null;
    url?: string | null;
    status?: string;
    servicesOffered?: Array<{
      name?: string;
      description?: string;
      price?: number;
    }>;
    serviceSelected?: string | null;
    followUps?: IFollowUp[];
    followUpCount?: number;
    maxFollowUpsAllowed?: number;
    nextFollowUpDate?: Date | null;
    lastFollowUpDate?: Date | null;
    followUpOverdue?: boolean;
    firstContactDue?: Date | null;
    firstContactAt?: Date | null;
    firstContactDone?: boolean;
    firstContactOverdue?: boolean;
    research?: {
      status?: boolean;
      notes?: string | null;
      done?: boolean | null;
    };
    lostReason?:
      | "budget-too-low"
      | "not-interested"
      | "found-competitor"
      | "no-response"
      | "timing-issue"
      | "wrong-fit"
      | "other"
      | null;
    quotedPrice?: number | null;
    finalPrice?: number | null;
    currency?: string;
    dealProbability?: number;
    attachments?: IAttachment[];
    reminderDate?: Date | null;
    callBackDate?: Date | null;
    notes?: INote[];
    assignedTo?: mongoose.Types.ObjectId | null;
    source?:
      | "apify"
      | "manual"
      | "referral"
      | "import"
      | "website"
      | "google-map"
      | "other";
    activity?: IActivity[];
    timeline?: string | null;
    purpose?: string | null;
    tags?: string[];
    createdAt?: Date;
    updatedAt?: Date;
  }

  // --- Miscellaneous ---
  interface ICallbackLog extends mongoose.Document {
    clientCode: string;
    callbackUrl: string;
    method: string;
    payload?: any;
    jobId?: string;
    enrollmentId?: string;
    responseStatus: number;
    responseBody: string;
    status: "sent" | "failed" | "pending_retry";
    attempts: number;
    lastAttemptAt?: Date;
    signature?: string;
    createdAt: Date;
    updatedAt: Date;
  }

  interface IEventLog extends mongoose.Document {
    clientCode: string;
    trigger: string;
    phone?: string;
    email?: string;
    status: "received" | "processing" | "completed" | "partial" | "failed";
    rulesMatched: number;
    jobsCreated: number;
    meetLink?: string;
    callbackUrl?: string;
    callbackStatus: "not_required" | "sent" | "failed";
    payload?: any;
    error?: string;
    idempotencyKey?: string;
    processedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  interface CrmModels {
    Lead: mongoose.Model<ILead>;
    Pipeline: mongoose.Model<IPipeline>;
    PipelineStage: mongoose.Model<IPipelineStage>;
    LeadActivity: mongoose.Model<ILeadActivity>;
    LeadNote: mongoose.Model<ILeadNote>;
    AutomationRule: mongoose.Model<IAutomationRule>;
    Meeting: mongoose.Model<IMeeting>;
    Notification: mongoose.Model<INotification>;
    EventLog: mongoose.Model<IEventLog>;
    CallbackLog: mongoose.Model<ICallbackLog>;
    CustomEventDef: mongoose.Model<ICustomEventDef>;
    Segment: mongoose.Model<ISegment>;
    Conversation: mongoose.Model<IConversation>;
    Message: mongoose.Model<IMessage>;
    Template: mongoose.Model<ITemplate>;
    SequenceEnrollment: mongoose.Model<ISequenceEnrollment>;
    Broadcast: mongoose.Model<IBroadcast>;
    EmailCampaign: mongoose.Model<any>;
    ScoringConfig: mongoose.Model<any>;
    conn: mongoose.Connection;
  }

  interface CreateLeadInput {
    firstName: string;
    lastName?: string;
    email?: string;
    phone: string;
    source?: LeadSource;
    dealValue?: number;
    currency?: string;
    dealTitle?: string;
    assignedTo?: string;
    tags?: string[];
    pipelineId?: string;
    stageId?: string;
    metadata?: {
      refs?: {
        appointmentId?: string;
        bookingId?: string;
        orderId?: string;
        productId?: string;
        serviceId?: string;
        meetingId?: string;
        [key: string]: string | undefined;
      };
      extra?: Record<string, string | number | boolean | null>;
    };
    dynamicFields?: Record<string, any>;
  }

  interface UpdateLeadInput {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    dealValue?: number;
    currency?: string;
    dealTitle?: string;
    assignedTo?: string;
    tags?: string[];
  }

  interface SDK {
    /**
     * **Lead Management SDK**
     *
     * Primary facade for CRM lead operations: CRUD, stage transitions, tagging, and scoring.
     *
     * **WORKING PROCESS:**
     * 1. Validates tenant access via `clientCode`.
     * 2. Delegates to `lead.service.ts`.
     * 3. Triggers `automation:trigger` if stage/status changes.
     *
     * **PRIMARY METHODS:**
     * - `sdk.lead.create(...)`: Register new prospects.
     * - `sdk.lead.updateStage(...)`: Move leads through sales funnel.
     */
    lead: import("../sdk/lead.sdk").LeadSDK;

    /**
     * **Pipeline & Analytics SDK**
     *
     * Manage Kanban pipelines, sales stages, and revenue forecasting.
     */
    pipeline: import("../sdk/pipeline.sdk").PipelineSDK;

    /**
     * **Activity & Timeline SDK**
     *
     * Log interactions (calls, notes) and retrieve lead history.
     */
    activity: import("../sdk/activity.sdk").ActivitySDK;

    /**
     * **WhatsApp Business SDK**
     *
     * Send templates, free-text, and media messages via Meta Cloud API.
     *
     * **EVENTS EMITTED:**
     * - `whatsapp:received`: New inbound message.
     * - `whatsapp:status`: Message status updates.
     */
    whatsapp: import("../sdk/whatsapp.sdk").WhatsAppSDK;

    /**
     * **Media Storage SDK (Legacy Alias)**
     * @deprecated Use `sdk.storage` instead.
     */
    media: import("../sdk/storage.sdk").StorageSDK;

    /**
     * **Cloudflare R2 Storage SDK**
     *
     * Handles file uploads, optimizing media, and generating presigned URLs.
     */
    storage: import("../sdk/storage.sdk").StorageSDK;

    /**
     * **EMail Services SDK**
     *
     * Dispatch bulk campaigns or single transactional emails.
     */
    mail: import("../sdk/mail.sdk").MailSDK;

    /**
     * **Google Meet SDK**
     *
     * Schedule online appointments and sync with Google Calendar.
     */
    meet: import("../sdk/meet.sdk").MeetSDK;

    /**
     * **Automation Orchestration SDK**
     *
     * Enroll leads in sequences and execute immediate background actions.
     */
    automation: import("../sdk/automation.sdk").AutomationSDK;

    /**
     * **Alerts & Notifications SDK**
     *
     * Create actionable staff notifications for critical CRM events.
     */
    notification: import("../sdk/notification.sdk").NotificationSDK;

    /**
     * **Background Job SDK**
     *
     * Enqueue standard CRM tasks (email dispatch, score refresh) to ErixWorkers.
     */
    jobs: import("../sdk/job.sdk").JobSDK;

    /**
     * **Isolated Tenant Cache SDK**
     *
     * High-speed storage for frequently accessed tenant metadata.
     */
    cache: import("../sdk/cache.sdk").CacheSDK;
  }

  // --- Service Types ---
  interface EmailDetails {
    to: string;
    subject: string;
    html?: string;
    text?: string;
  }

  interface CampaignDetails {
    recipients: string[];
    subject: string;
    html: string;
  }

  interface GoogleMeetResponse {
    success: boolean;
    hangoutLink?: string;
    eventId?: string;
    summary?: string;
    error?: string;
  }

  interface LogActivityInput {
    leadId: string;
    type: ActivityType;
    title: string;
    body?: string;
    metadata?: Record<string, unknown>;
    performedBy?: string;
  }

  interface TimelineItem {
    id: string;
    kind: "activity" | "note";
    type?: ActivityType;
    title: string;
    body?: string;
    metadata?: Record<string, unknown>;
    isPinned?: boolean;
    performedBy?: string;
    createdBy?: string;
    createdAt: Date;
  }

  interface WhatsAppServiceContext {
    secrets: any;
    Conversation: mongoose.Model<IConversation>;
    Message: mongoose.Model<IMessage>;
    Template: mongoose.Model<ITemplate>;
    tenantConn: mongoose.Connection;
  }

  type AnalyticsRange = "24h" | "7d" | "30d" | "60d" | "90d" | "365d";

  // Jobs
  type JobStatus = "waiting" | "active" | "completed" | "failed";

  interface AddJobOptions {
    /** Delay in ms before the job becomes eligible to run. Default: 0 (run immediately). */
    delayMs?: number;
    /** Explicit execution time. Takes precedence over delayMs. */
    runAt?: Date;
    /** Lower number = higher priority. Default: 5. */
    priority?: number;
    /** Maximum number of attempts before the job is marked failed. Default: 3. */
    maxAttempts?: number;
  }

  interface WorkerOptions {
    /** How many jobs to process in parallel. Default: 1. */
    concurrency?: number;
    /** How often (ms) the worker polls the DB for new jobs. Default: 10_000. */
    pollIntervalMs?: number;
    /** Base delay (ms) for exponential backoff. Retry n uses: baseBackoffMs * 2^n. Default: 5_000. */
    baseBackoffMs?: number;
    /** Maximum number of jobs to process per second. Default: null (unlimited). */
    maxJobsPerSecond?: number | null;
  }

  type ProcessorFn = (job: IJob) => Promise<void>;

  interface IJob extends mongoose.Document {
    clientCode: string;
    queue: string;
    status: JobStatus;
    data: Record<string, unknown>;
    priority: number;
    runAt: Date;
    attempts: number;
    maxAttempts: number;
    lastError?: string;
    completedAt?: Date;
    failedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  interface ListResult {
    key: string;
    url: string;
    size: number;
    lastModified?: Date;
    mimeType?: string;
  }

  interface PredefinedReply {
    keywords: string[];
    reply: string;
    quickReplies: string[];
  }

  interface EventPayload {
    phone?: string;
    email?: string;
    variables?: Record<string, string>;
    data?: Record<string, any>;
  }

  interface OptimizedMediaResult extends UploadResult {
    mimeType: string;
    fileName: string;
    r2Key?: string;
  }
}
