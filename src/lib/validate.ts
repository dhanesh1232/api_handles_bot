/**
 * Centralized schema registry for all structural data validation across the platform.
 *
 * **GOAL:** Enforce strict type safety and data integrity at the system entry-points (SDK calls, API requests).
 *
 * **DETAILED EXECUTION:**
 * 1. **Primitive Definition**: Establishes reusable atoms like `phone` (with regex normalization) and `mongoId`.
 * 2. **Composite Object Assembly**: Builds complex validation trees for Leads, Pipelines, and Activities.
 * 3. **Input Sanitization**: Automatically trims strings and coerces numeric strings (from query params) into proper JS Numbers.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Schema Violation: Throws a standard `ZodError` which is intercepted by the global middleware to return structured `fieldErrors` to the client.
 */

import { z } from "zod";

// ─── Common primitives ────────────────────────────────────────────────────────

const phone = z
  .string()
  .trim()
  .min(7, "phone must be at least 7 digits")
  .regex(/^\+?[\d\s\-().]+$/, "invalid phone format");

const mongoId = z.string().regex(/^[a-f\d]{24}$/i, "invalid ObjectId");

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

// ─── Lead Schemas ─────────────────────────────────────────────────────────────

const LeadStatus = z.enum(["new", "active", "won", "lost", "archived"]);
const LeadSource = z.enum([
  "website",
  "whatsapp",
  "referral",
  "ad",
  "walk_in",
  "phone",
  "email",
  "social",
  "other",
]);

export const LeadSchemas = {
  create: z.object({
    firstName: z.string().trim().min(1, "firstName is required"),
    lastName: z.string().trim().optional(),
    phone: phone,
    email: z.string().email("invalid email").optional().or(z.literal("")),
    source: LeadSource.optional().default("other"),
    pipelineId: mongoId.optional(),
    stageId: mongoId.optional(),
    assignedTo: mongoId.optional(),
    tags: z.array(z.string().trim()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    metadata: z
      .object({
        refs: z
          .object({
            appointmentId: z.string().optional(),
            bookingId: z.string().optional(),
            orderId: z.string().optional(),
            meetingId: z.string().optional(),
          })
          .optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  }),

  update: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().optional(),
    phone: phone.optional(),
    email: z.string().email().optional().or(z.literal("")),
    source: LeadSource.optional(),
    status: LeadStatus.optional(),
    assignedTo: mongoId.optional().nullable(),
    tags: z.array(z.string().trim()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    score: z.number().int().min(0).max(100).optional(),
  }),

  move: z.object({
    stageId: mongoId,
    movedBy: z.string().optional(),
  }),

  convert: z.object({
    outcome: z.enum(["won", "lost"]),
    reason: z.string().trim().optional(),
  }),

  bulkDelete: z.object({
    ids: z.array(mongoId).min(1).max(500),
  }),

  upsert: z.object({
    leadData: z.object({
      name: z.string().trim().optional(),
      phone: phone,
      email: z.string().email().optional().or(z.literal("")),
      source: LeadSource.optional(),
      message: z.string().trim().optional(),
    }),
    pipelineId: mongoId.optional(),
    stageId: mongoId.optional(),
    trigger: z.string().optional(),
    moduleInfo: z
      .object({
        type: z.enum([
          "service_enrollment",
          "doctor_consultation",
          "product_purchase",
        ]),
        id: z.string(),
      })
      .optional(),
  }),

  listQuery: paginationQuery.extend({
    status: LeadStatus.optional(),
    pipelineId: mongoId.optional(),
    stageId: mongoId.optional(),
    source: LeadSource.optional(),
    assignedTo: mongoId.optional(),
    tags: z.string().optional(), // comma-separated, parsed in handler
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    search: z.string().trim().optional(),
    appointmentId: z.string().optional(),
    bookingId: z.string().optional(),
    orderId: z.string().optional(),
    meetingId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    sortBy: z.enum(["createdAt", "score", "updatedAt"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }),
};

// ─── Pipeline Schemas ─────────────────────────────────────────────────────────

export const PipelineSchemas = {
  create: z.object({
    name: z.string().trim().min(1, "name is required"),
    description: z.string().trim().optional(),
    isDefault: z.boolean().optional(),
    template: z.string().optional(),
    stages: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          color: z.string().optional(),
          probability: z.number().min(0).max(100).optional(),
          isWon: z.boolean().optional(),
          isLost: z.boolean().optional(),
        }),
      )
      .optional()
      .default([]),
  }),

  update: z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    order: z.number().int().positive().optional(),
  }),

  addStage: z.object({
    name: z.string().trim().min(1, "name is required"),
    color: z.string().optional(),
    probability: z.number().min(0).max(100).optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    insertAfterOrder: z.number().int().optional(),
  }),

  reorderStages: z.object({
    order: z
      .array(z.object({ stageId: mongoId, order: z.number().int() }))
      .min(1),
  }),
};

// ─── Activity Schemas ─────────────────────────────────────────────────────────

const ActivityType = z.enum([
  "note",
  "call",
  "email",
  "meeting",
  "whatsapp",
  "stage_change",
  "automation_triggered",
  "status_change",
]);

export const ActivitySchemas = {
  log: z.object({
    leadId: mongoId,
    type: ActivityType,
    title: z.string().trim().min(1, "title is required"),
    body: z.string().trim().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    performedBy: z.string().optional(),
  }),

  createNote: z.object({
    content: z.string().trim().min(1, "content is required"),
    createdBy: z.string().optional(),
  }),

  logCall: z.object({
    durationMinutes: z.number().int().min(0).default(0),
    summary: z.string().trim().min(1, "summary is required"),
    outcome: z.string().optional(),
    performedBy: z.string().optional(),
  }),
};

// ─── WhatsApp Schemas ─────────────────────────────────────────────────────────

export const WhatsAppSchemas = {
  send: z.object({
    conversationId: mongoId,
    text: z.string().max(4096).optional().or(z.literal("")),
    mediaUrl: z.string().url().optional().or(z.literal("")),
    mediaType: z.string().optional(),
    userId: z.string().optional(),
    replyToId: z.string().optional(),
  }),

  sendTemplate: z.object({
    conversationId: mongoId,
    templateName: z.string().trim().min(1),
    language: z.string().default("en"),
    variables: z.array(z.string()).optional().default([]),
    userId: z.string().optional(),
  }),

  sendReaction: z.object({
    messageId: z.string().min(1),
    reaction: z.string().max(8, "must be a single emoji").or(z.literal("")),
  }),
};

// ─── Export all ───────────────────────────────────────────────────────────────

export const Schemas = {
  Lead: LeadSchemas,
  Pipeline: PipelineSchemas,
  Activity: ActivitySchemas,
  WhatsApp: WhatsAppSchemas,
} as const;
