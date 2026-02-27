<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />

# ECODrIx Backend API

**Multi-tenant Business Automation Engine** — API-first, production-grade.

</div>

---

## Table of Contents

1. [Authentication](#authentication)
2. [Response Format](#response-format)
3. [Client Onboarding Checklist](#client-onboarding-checklist)
4. [Workflow Triggers](#1-workflow-triggers--core-entry-point)
5. [CRM → Leads](#2-crm--leads)
6. [CRM → Pipelines & Stages](#3-crm--pipelines--stages)
7. [CRM → Activities, Calls & Notes](#4-crm--activities-calls--notes)
8. [CRM → Automations](#5-crm--automations)
9. [CRM → Analytics & Scoring](#6-crm--analytics--scoring)
10. [WhatsApp → Chat & Messaging](#7-whatsapp--chat--messaging)
11. [WhatsApp → Templates](#8-whatsapp--templates)
12. [WhatsApp → Broadcasts](#9-whatsapp--broadcasts)
13. [Monitoring → Health, Events & Jobs](#10-monitoring--health-events--jobs)
14. [Client Integration Guide](#client-integration-guide)
15. [Callback Verification](#callback-verification)
16. [Tech Stack](#tech-stack)

---

## Authentication

Every request to a tenant-specific route must include two headers:

```http
x-api-key: <client_api_key>
x-client-code: <client_code>
```

These identify and authenticate your tenant. The `x-client-code` routes your request to your isolated database. **Never expose these in frontend code.**

> [!CAUTION]
> Always call ECODrIx APIs from your server side (Next.js API routes, Express handlers, etc.). Never expose your `x-api-key` in browser code.

---

## Response Format

All responses follow a unified JSON envelope:

**Success:**

```json
{ "success": true, "data": { ... } }
```

**Error:**

```json
{ "success": false, "message": "Human-readable reason", "code": "ERROR_CODE" }
```

**Paginated:**

```json
{
  "success": true,
  "data": [...],
  "total": 250,
  "page": 1,
  "limit": 25,
  "totalPages": 10
}
```

---

## Client Onboarding Checklist

Before a client can call the API, you (ECODrIx admin) must complete these setup steps via admin APIs:

```
☐ 1. POST /api/clients
      → Creates clientCode + API key

☐ 2. POST /api/clients/:code/secrets
      Secrets required:
        whatsappToken, whatsappBusinessId, whatsappPhoneNumberId,
        whatsappWebhookToken,
        smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom,
        automationWebhookSecret  ← 32-char hex, for signing callbacks

☐ 3. POST /api/clients/:code/datasource
      { "dbUri": "mongodb+srv://..." }

☐ 4. GET /api/auth/google/connect?clientCode=<code>   ← browser OAuth for Meet

☐ 5. POST /api/saas/chat/templates/sync              ← pull WhatsApp templates from Meta

☐ 6. POST /api/saas/cors  (only if client calls from browser)
      { "url": "https://client-domain.com" }

☐ 7. POST /api/crm/automations  ← configure at least one automation rule

☐ 8. Share with client: API_URL, API_KEY, CLIENT_CODE, WEBHOOK_SECRET
```

---

## 1. Workflow Triggers — Core Entry Point

The single endpoint any client website calls to fire an automation.
**Rate limit:** 60 requests / minute / tenant.

### `POST /api/saas/workflows/trigger`

**Required headers:** `x-api-key`, `x-client-code`

**Full payload:**

```json
{
  "trigger": "appointment_confirmed",
  "phone": "919876543210",
  "email": "patient@example.com",
  "variables": {
    "patientName": "Ravi Kumar",
    "doctorName": "Dr. Sharma",
    "appointmentTime": "3:00 PM"
  },
  "data": {
    "appointmentId": "6abc...",
    "amount": 1500
  },
  "requiresMeet": true,
  "meetConfig": {
    "title": "Consultation: Dr. Sharma + Ravi",
    "startTime": "2026-03-15T09:30:00Z",
    "durationMinutes": 30,
    "attendeeEmail": "patient@example.com"
  },
  "callbackUrl": "https://your-site.com/api/ecodrix-callback",
  "callbackMetadata": { "appointmentId": "6abc..." },
  "delayMinutes": 0,
  "createLeadIfMissing": true,
  "leadData": {
    "firstName": "Ravi",
    "lastName": "Kumar",
    "email": "patient@example.com",
    "source": "website"
  }
}
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "eventLogId": "65b2...",
    "trigger": "appointment_confirmed",
    "leadId": "65b2...",
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "meetWarning": null,
    "rulesMatched": 2,
    "scheduled": false
  }
}
```

> [!NOTE]
> If `requiresMeet: true` but Google OAuth isn't configured, `meetLink` will be `null` and `meetWarning` will explain why. The rest of the trigger still runs normally.

**All supported trigger names:**

| Trigger                 | Fired by | Description                                   |
| ----------------------- | -------- | --------------------------------------------- |
| `appointment_confirmed` | Client   | Appointment book/confirm                      |
| `appointment_cancelled` | Client   | Appointment cancellation                      |
| `appointment_reminder`  | Client   | Pre-appointment reminder (use `delayMinutes`) |
| `form_submitted`        | Client   | Contact / inquiry form                        |
| `payment_captured`      | Client   | Payment successful                            |
| `product_purchased`     | Client   | eCommerce purchase                            |
| `service_enrolled`      | Client   | Course / service enrolment                    |
| `deal_won`              | Client   | Manually mark deal as won                     |
| `deal_lost`             | Client   | Manually mark deal as lost                    |
| `stage_enter`           | System   | Lead moved into a stage                       |
| `stage_exit`            | System   | Lead moved out of a stage                     |
| `lead_created`          | System   | New lead created in CRM                       |
| `score_above`           | System   | Lead score crosses hot threshold              |
| `score_below`           | System   | Lead score drops below cold threshold         |
| `tag_added`             | System   | Tag applied to a lead                         |
| `tag_removed`           | System   | Tag removed from a lead                       |
| `no_contact`            | System   | Lead inactive for N days (cron job)           |

---

## 2. CRM → Leads

**Base path:** `/api/crm`
**Auth:** `x-api-key` + `x-client-code` (all routes)

### `GET /api/crm/fields`

Returns all mappable lead fields (core + discovered from metadata).

---

### `POST /api/crm/leads`

Create a new lead. Auto-assigns to default pipeline and stage.

**Minimal payload:**

```json
{ "firstName": "Suresh", "phone": "+919876543210" }
```

**Full payload:**

```json
{
  "firstName": "Suresh",
  "lastName": "Rao",
  "phone": "+919876543210",
  "email": "suresh@example.com",
  "source": "website",
  "dealValue": 120000,
  "dealTitle": "OPD Automation Package",
  "pipelineId": "6789abc...",
  "stageId": "6789def...",
  "metadata": {
    "refs": {
      "appointmentId": "6789aaa...",
      "bookingId": "6789bbb..."
    },
    "extra": {
      "appointmentDate": "2026-03-01",
      "plan": "Premium"
    }
  }
}
```

> [!NOTE]
> If the client has no pipeline yet, ECODrIx auto-creates a default "sales" pipeline with 7 stages. This prevents crashes on first trigger for brand-new tenants.

---

### `GET /api/crm/leads`

List and filter leads with pagination.

**Query params:**

| Param           | Type                                                      | Description                              |
| --------------- | --------------------------------------------------------- | ---------------------------------------- |
| `status`        | `open\|won\|lost\|archived`                               | Filter by status                         |
| `pipelineId`    | ObjectId                                                  | Filter by pipeline                       |
| `stageId`       | ObjectId                                                  | Filter by stage                          |
| `source`        | string                                                    | Lead source filter                       |
| `assignedTo`    | string                                                    | Assigned team member                     |
| `tags`          | `tag1,tag2`                                               | Comma-separated tag filter               |
| `minScore`      | number                                                    | Minimum lead score                       |
| `search`        | string                                                    | Full-text: name, email, phone, dealTitle |
| `appointmentId` | ObjectId                                                  | Filter by metadata ref                   |
| `bookingId`     | ObjectId                                                  | Filter by metadata ref                   |
| `orderId`       | ObjectId                                                  | Filter by metadata ref                   |
| `page`          | number                                                    | Default: 1                               |
| `limit`         | number                                                    | Default: 25                              |
| `sortBy`        | `score\|createdAt\|updatedAt\|dealValue\|lastContactedAt` | Sort field                               |
| `sortDir`       | `asc\|desc`                                               | Sort direction                           |

---

### `GET /api/crm/leads/:leadId`

Get a single lead with populated pipeline and stage.

### `PATCH /api/crm/leads/:leadId`

Update lead fields (name, phone, email, dealValue, tags, etc.).

### `PATCH /api/crm/leads/:leadId/metadata`

Update cross-reference IDs and extra metadata without touching core fields.

```json
{
  "refs": { "appointmentId": "new-id" },
  "extra": { "plan": "Enterprise" }
}
```

### `PATCH /api/crm/leads/:leadId/move`

Move lead to a different pipeline stage.

```json
{ "stageId": "6789abc..." }
```

### `PATCH /api/crm/leads/:leadId/convert`

Convert a lead to "won" or "lost" status.

```json
{ "status": "won", "reason": "Signed contract" }
```

### `PATCH /api/crm/leads/:leadId/tags`

Add or remove tags atomically.

```json
{ "add": ["hot", "vip"], "remove": ["cold"] }
```

### `PATCH /api/crm/leads/:leadId/archive`

Soft-archive a lead (excluded from all listings).

### `GET /api/crm/leads/by-ref`

Find a lead by external reference ID.

```
GET /api/crm/leads/by-ref?field=appointmentId&value=6abc...
```

### `GET /api/crm/pipelines/:pipelineId/stages/:stageId/leads`

Get leads for a specific pipeline stage (for Kanban column rendering).

### `POST /api/crm/leads/import`

Bulk upsert up to 1000 leads by phone. Existing leads are updated, new ones are created.

```json
{
  "leads": [
    { "firstName": "A", "phone": "919876543210", "source": "website" },
    { "firstName": "B", "phone": "919999999999" }
  ]
}
```

---

## 3. CRM → Pipelines & Stages

### `GET /api/crm/pipelines`

List all active pipelines with their stages.

### `GET /api/crm/pipelines/:pipelineId`

Get one pipeline with all its stages.

### `POST /api/crm/pipelines`

Create a pipeline. Use a built-in template or pass custom stages.

**Built-in templates:** `sales` | `support` | `recruitment` | `marketing` | `appointment` | `product_purchase`

```json
{
  "name": "Patient Journey",
  "isDefault": true,
  "template": "appointment"
}
```

Or with custom stages:

```json
{
  "name": "Custom Pipeline",
  "stages": [
    { "name": "Inquiry", "color": "#6366f1", "probability": 10 },
    {
      "name": "Consulted",
      "color": "#10b981",
      "probability": 60,
      "isWon": true
    }
  ]
}
```

### `PATCH /api/crm/pipelines/:pipelineId`

Update pipeline name or description.

### `PATCH /api/crm/pipelines/:pipelineId/default`

Make this the default pipeline (unsets all others).

### `DELETE /api/crm/pipelines/:pipelineId`

Soft-archive a pipeline. Cannot archive the default pipeline.

### `POST /api/crm/pipelines/:pipelineId/duplicate`

Clone a pipeline with all stages (no leads copied).

```json
{ "name": "Copy of Patient Journey" }
```

### `POST /api/crm/pipelines/:pipelineId/stages`

Add a new stage.

```json
{ "name": "Under Review", "color": "#f59e0b", "probability": 40 }
```

### `PATCH /api/crm/stages/:stageId`

Update a stage's name, color, probability, or win/loss status.

### `PATCH /api/crm/pipelines/:pipelineId/stages/reorder`

Save new stage order after drag-and-drop.

```json
{
  "order": [
    { "stageId": "abc", "newOrder": 0 },
    { "stageId": "def", "newOrder": 1 }
  ]
}
```

### `DELETE /api/crm/stages/:stageId`

Delete a stage. If leads exist, provide `moveLeadsToStageId` to migrate them first.

```json
{ "moveLeadsToStageId": "6789xyz..." }
```

### `GET /api/crm/pipelines/:pipelineId/board`

Kanban board summary — each stage with lead count and total deal value (uses aggregation, fast).

### `GET /api/crm/pipelines/:pipelineId/forecast`

Revenue forecast: deal value × probability per stage.

```json
{
  "data": {
    "rows": [
      {
        "stageName": "Proposal",
        "probability": 60,
        "totalValue": 500000,
        "expectedRevenue": 300000
      }
    ],
    "grandTotal": 850000,
    "totalPipeline": 1500000
  }
}
```

---

## 4. CRM → Activities, Calls & Notes

### `GET /api/crm/leads/:leadId/timeline`

Unified timeline: activities + notes merged, sorted newest-first.
**Query:** `page`, `limit`

### `GET /api/crm/leads/:leadId/activities`

Activities only.
**Query:** `type` (filter by activity type), `page`, `limit`

### `POST /api/crm/leads/:leadId/activities`

Log a manual activity (meeting, email, custom).

```json
{
  "type": "meeting",
  "title": "Demo call with Dr. Sharma",
  "body": "Discussed the appointment automation workflow.",
  "performedBy": "sales_team"
}
```

### `POST /api/crm/leads/:leadId/calls`

Shortcut: log a phone call.

```json
{
  "durationMinutes": 12,
  "summary": "Explained pricing",
  "outcome": "interested"
}
```

### `GET /api/crm/leads/:leadId/notes`

Get all notes — pinned notes first, then newest.

### `POST /api/crm/leads/:leadId/notes`

Create a note.

```json
{ "content": "Patient prefers evening slots.", "createdBy": "Dr. Sharma" }
```

### `PATCH /api/crm/notes/:noteId`

Edit note content.

### `PATCH /api/crm/notes/:noteId/pin`

Toggle pin status.

### `DELETE /api/crm/notes/:noteId`

Delete a note.

---

## 5. CRM → Automations

Configure what ECODrIx does when a trigger fires.

### `GET /api/crm/automations`

List all automation rules.

### `POST /api/crm/automations`

Create an automation rule.

**Example: Send WhatsApp on appointment confirmation**

```json
{
  "name": "Appointment Confirmed WA",
  "trigger": "appointment_confirmed",
  "triggerConfig": {},
  "actions": [
    {
      "type": "send_whatsapp",
      "delayMinutes": 0,
      "config": {
        "templateName": "appointment_confirmed",
        "language": "en_US"
      }
    }
  ]
}
```

**Example: Archive cold leads when score drops**

```json
{
  "name": "Auto-archive cold dead leads",
  "trigger": "score_below",
  "triggerConfig": { "scoreThreshold": 20 },
  "condition": {
    "field": "source",
    "operator": "eq",
    "value": "cold_outreach"
  },
  "actions": [
    { "type": "add_tag", "delayMinutes": 0, "config": { "tag": "cold-dead" } }
  ]
}
```

**Available action types:**

| Type            | Config fields              | Description              |
| --------------- | -------------------------- | ------------------------ |
| `send_whatsapp` | `templateName`, `language` | Send WA template message |
| `send_email`    | `subject`, `htmlBody`      | Send email via SMTP      |
| `move_stage`    | `stageId`                  | Move lead to stage       |
| `assign_to`     | `assignTo`                 | Assign to team member    |
| `add_tag`       | `tag`                      | Add a tag                |
| `remove_tag`    | `tag`                      | Remove a tag             |

### `PATCH /api/crm/automations/:ruleId`

Update any fields on a rule.

### `PATCH /api/crm/automations/:ruleId/toggle`

Enable or disable a rule without deleting it.

### `DELETE /api/crm/automations/:ruleId`

Delete a rule permanently.

### `POST /api/crm/automations/:ruleId/test`

Dry-run a rule against a specific lead. Does NOT execute actions.

```json
{ "leadId": "65b2..." }
```

> [!WARNING]
> `POST /api/crm/automations/events` is **deprecated**. Use `POST /api/saas/workflows/trigger` instead — it supports Meet links, callbacks, EventLog, and delayed execution.

---

## 6. CRM → Analytics & Scoring

### Analytics

All analytics endpoints accept `range` = `7d` | `30d` | `90d` | `365d`.

| Endpoint                                           | Description                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/crm/analytics/overview?range=30d`        | KPIs: total leads, pipeline value, conversion rate, avg score |
| `GET /api/crm/analytics/funnel?pipelineId=...`     | Stage-by-stage lead counts + conversion %                     |
| `GET /api/crm/analytics/forecast?pipelineId=...`   | Revenue forecast (deal value × probability)                   |
| `GET /api/crm/analytics/sources?range=30d`         | Lead source breakdown with conversion rates                   |
| `GET /api/crm/analytics/team?range=30d`            | Team leaderboard: won deals, revenue, activity count          |
| `GET /api/crm/analytics/heatmap?range=30d`         | Daily activity heatmap (for calendar view)                    |
| `GET /api/crm/analytics/scores`                    | Score distribution across 0-20-40-60-80-100 buckets           |
| `GET /api/crm/analytics/stage-time?pipelineId=...` | Avg time leads spend per stage (bottleneck detector)          |

### Lead Scoring

### `GET /api/crm/scoring`

Get current scoring configuration (rules, hot/cold thresholds).

### `PATCH /api/crm/scoring`

Update scoring rules and thresholds.

```json
{
  "hotThreshold": 70,
  "coldThreshold": 20,
  "rules": [
    { "field": "source", "operator": "eq", "value": "referral", "score": 20 },
    { "field": "dealValue", "operator": "gt", "value": 50000, "score": 15 }
  ],
  "recalculateOnTriggers": ["appointment_confirmed", "payment_captured"]
}
```

### `POST /api/crm/scoring/:leadId/recalculate`

Force-recalculate score for a single lead immediately.

---

## 7. WhatsApp → Chat & Messaging

### `GET /api/saas/chat/conversations`

Get all conversations in your WhatsApp inbox, sorted by last message time.

### `GET /api/saas/chat/conversations/:id/messages`

Get message history for a conversation.

### `POST /api/saas/chat/conversations`

Manually create a conversation for a phone number.

```json
{ "phone": "+919876543210", "name": "Ravi Kumar" }
```

### `POST /api/saas/chat/conversations/:id/read`

Mark all messages in a conversation as read.

### `DELETE /api/saas/chat/conversations/:id`

Delete a conversation and all its messages.

### `POST /api/saas/chat/send`

Send an outbound message.

```json
{
  "to": "+919876543210",
  "text": "Hello, your appointment is confirmed!",
  "templateName": "appointment_confirmed",
  "templateLanguage": "en_US"
}
```

### `POST /api/saas/chat/upload`

Upload media (image, PDF, video) for use in messages.

- **Form field:** `file` (multipart/form-data)
- **Returns:** `{ url: "https://...", mimeType: "image/jpeg" }`

### `POST /api/saas/chat/messages/:messageId/star`

Toggle star status on a message.

### `POST /api/saas/chat/messages/:messageId/react`

Add a reaction emoji to a message.

```json
{ "emoji": "👍" }
```

---

## 8. WhatsApp → Templates

### `GET /api/saas/chat/templates`

List synced WhatsApp templates.
**Query:** `status` (approved/rejected/pending), `mappingStatus`, `channel`

### `GET /api/saas/chat/templates/:templateName`

Get a single template with full variable mapping details.

### `POST /api/saas/chat/templates/sync`

Pull latest approved templates from Meta Business Manager into your tenant DB.

### `PUT /api/saas/chat/templates/:templateName/mapping`

Configure which CRM fields map to which template variables.

```json
{
  "mappings": [
    { "variableIndex": 1, "source": "lead", "field": "firstName" },
    { "variableIndex": 2, "source": "event", "field": "doctorName" }
  ],
  "onEmptyVariable": "skip"
}
```

### `GET /api/saas/chat/templates/:templateName/validate`

Validate that all template variables have a mapping configured.

### `POST /api/saas/chat/templates/:templateName/preview`

Preview resolved template with real data.

```json
{
  "context": {
    "lead": { "firstName": "Ravi" },
    "event": { "doctorName": "Dr. Sharma" }
  }
}
```

### `GET /api/saas/chat/collections`

List all tenant DB collections available for template variable mapping.

### `GET /api/saas/chat/collections/:name/fields`

Get all fields from a specific collection for variable mapping configuration.

---

## 9. WhatsApp → Broadcasts

### `POST /api/saas/chat/broadcast`

Create and launch a bulk WhatsApp campaign. Jobs are enqueued per recipient — non-blocking.

```json
{
  "name": "Summer Health Camp",
  "templateName": "health_camp_invite",
  "recipients": [
    { "phone": "+919876543210", "variables": ["Ravi", "March 20"] },
    { "phone": "+919999999999", "variables": ["Priya", "March 20"] }
  ]
}
```

### `GET /api/saas/chat/broadcasts`

List all broadcast campaigns with status summary.

---

## 10. Monitoring → Health, Events & Jobs

### `GET /api/saas/health`

Public health check. Returns server uptime and DB connectivity.

```json
{ "status": "ok", "uptime": 3600, "db": "connected" }
```

### `GET /api/saas/health/client`

Client-specific health. Returns service connectivity + queue depth.

```json
{
  "data": {
    "clientCode": "nirvisham",
    "services": {
      "whatsapp": "connected",
      "email": "configured",
      "googleMeet": "configured"
    },
    "activeAutomations": 5,
    "queueDepth": 0
  }
}
```

### `GET /api/saas/events/logs`

Paginated automation event history.
**Query:** `trigger`, `status`, `phone`, `startDate`, `endDate`, `page`, `limit`

### `GET /api/saas/events/logs/:logId`

Single event log detail.

### `GET /api/saas/events/stats`

Aggregated event stats. Best for dashboards.
**Query:** `startDate`, `endDate`

```json
{
  "data": {
    "totalEvents": 1250,
    "byTrigger": [
      { "trigger": "appointment_confirmed", "count": 420, "successRate": 0.98 }
    ],
    "byStatus": [
      { "status": "completed", "count": 1230 },
      { "status": "failed", "count": 20 }
    ]
  }
}
```

### `GET /api/saas/callbacks/logs`

Webhook delivery history — inspect if your server is receiving callbacks.
**Query:** `status`, `startDate`, `endDate`, `page`, `limit`

### `GET /api/saas/jobs/status/:jobId`

Real-time status of a background job (queued → processing → completed → failed).

---

## Client Integration Guide

### Step 1 — Install in your project

```bash
# No package needed — plain fetch. Save this as lib/ecodrix.ts
```

### Step 2 — Create the `ecodrix.ts` helper

```typescript
// lib/ecodrix.ts
const BASE = process.env.ECODRIX_API_URL!;
const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": process.env.ECODRIX_API_KEY!,
  "x-client-code": process.env.ECODRIX_CLIENT_CODE!,
};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
}

export const erix = {
  trigger: (payload: object) =>
    call("POST", "/api/saas/workflows/trigger", payload),
  getLeads: (q?: Record<string, string>) =>
    call("GET", `/api/crm/leads?${new URLSearchParams(q).toString()}`),
  createLead: (data: object) => call("POST", "/api/crm/leads", data),
  getLead: (id: string) => call("GET", `/api/crm/leads/${id}`),
  moveLead: (id: string, stageId: string) =>
    call("PATCH", `/api/crm/leads/${id}/move`, { stageId }),
  getTimeline: (leadId: string) =>
    call("GET", `/api/crm/leads/${leadId}/timeline`),
  addNote: (leadId: string, content: string) =>
    call("POST", `/api/crm/leads/${leadId}/notes`, { content }),
  getHealth: () => call("GET", "/api/saas/health/client"),
  getEventLogs: (q?: Record<string, string>) =>
    call("GET", `/api/saas/events/logs?${new URLSearchParams(q).toString()}`),
};
```

### Step 3 — Fire events on appointment confirm

```typescript
// pages/api/appointment/confirm.ts (Next.js App Router)
import { erix } from "@/lib/ecodrix";

export async function POST(req: Request) {
  const body = await req.json();
  const { phone, patientName, doctorName, time, appointmentId, email } = body;

  // 1. Save to your own DB first
  const appt = await db.appointments.create({ ...body });

  // 2. Fire ECODrIx — non-blocking automation
  let meetLink: string | null = null;
  try {
    const result = await erix.trigger({
      trigger: "appointment_confirmed",
      phone,
      email,
      variables: { patientName, doctorName, time },
      data: { appointmentId: appt._id },
      requiresMeet: true,
      meetConfig: {
        title: `${doctorName} + ${patientName}`,
        startTime: new Date(appt.startTime).toISOString(),
        durationMinutes: 30,
        attendeeEmail: email,
      },
      callbackUrl: "https://your-site.com/api/ecodrix-callback",
      callbackMetadata: { appointmentId: appt._id.toString() },
      createLeadIfMissing: true,
      leadData: { firstName: patientName, email, source: "website" },
    });
    meetLink = result.data?.meetLink ?? null;
  } catch (err) {
    // ECODrIx failures MUST NOT break your app
    console.error("[ECODrIx] trigger failed:", err);
  }

  if (meetLink) await db.appointments.update(appt._id, { meetLink });

  return Response.json({ success: true, appointmentId: appt._id, meetLink });
}
```

### Step 4 — Handle callbacks on your server

```typescript
// pages/api/ecodrix-callback.ts
import crypto from "crypto";

const SECRET = process.env.ECODRIX_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-ecodrix-signature") ?? "";

  // Verify signature
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { trigger, meetLink, metadata } = JSON.parse(rawBody);

  if (
    trigger === "appointment_confirmed" &&
    meetLink &&
    metadata?.appointmentId
  ) {
    await db.appointments.update(metadata.appointmentId, { meetLink });
  }

  return Response.json({ received: true }); // Always 200 — ECODrIx retries on non-200
}
```

---

## Callback Verification

ECODrIx signs all outbound webhook callbacks with HMAC-SHA256.

```
Header: x-ecodrix-signature: sha256=<hex>
```

Verify it with `crypto.timingSafeEqual` to prevent timing attacks (see Step 4 above).

---

## Tech Stack

| Layer           | Technology                                        |
| --------------- | ------------------------------------------------- |
| Runtime         | Node.js v22, TypeScript (native ESM via `tsx`)    |
| Framework       | Express.js v5                                     |
| Real-time       | Socket.io                                         |
| Database        | MongoDB + Mongoose — Multi-tenant dynamic routing |
| Background Jobs | `MongoQueue` — custom job queue                   |
| Media           | Sharp + FFmpeg → Cloudflare R2                    |
| Auth            | HMAC API key + per-tenant isolation               |

---

## License

Copyright © 2026 **ECODrIx**. All rights reserved.
Proprietary and confidential. Unauthorized use prohibited.

---

## View Rendering

ECODrIx uses a custom lightweight template renderer located at `src/lib/renderView.ts`.

### How to use:
1. Place your `.html` file in `src/views/`.
2. Use `__TOKEN_NAME__` in your HTML for substitution.
3. Import `renderView` and call it in your route:

```typescript
import { renderView } from "../../lib/renderView";

router.get("/", (req, res) => {
  const html = renderView("index.html", {
    TOKEN_NAME: "Value",
    NONCE: res.locals.cspNonce // Required for <script> tags
  });
  res.send(html);
});
```

### Security (CSP & Nonce):
All templates must use a **nonce** for inline scripts to comply with the project's Content Security Policy:
- Add `nonce="__NONCE__"` to your `<script>` tags.
- Avoid `onclick=` attributes; use `addEventListener` instead.

---
