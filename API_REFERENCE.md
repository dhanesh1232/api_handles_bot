# ECODrIx API Reference

This document provides detailed information on all public and internal API endpoints available in the ECODrIx backend.

---

## 1. Authentication

### Client API Key (`x-api-key`)
Most SaaS and CRM endpoints require a client-specific API key.
- **Header**: `x-api-key: <YOUR_API_KEY>`
- **Header**: `x-client-code: <CLIENT_CODE>`

### Admin Token (`Authorization`)
Admin routes (e.g., `/api/clients`) require a Bearer token.
- **Header**: `Authorization: Bearer <CORE_API_TOKEN>`

---

## 2. Workflows & Triggers

The Trigger API is the primary entry point for external integrations (Webhooks, Lead forms, etc.).

### `POST /api/saas/workflows/trigger`

The primary ingestion point for all automations.

**Request Body:**
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

**Response:**
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

---

## 3. CRM — Leads

**Base Path**: `/api/crm`

### `GET /api/crm/leads`
List and filter leads with pagination.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `status` | `open\|won\|lost\|archived` | Filter by status |
| `pipelineId` | ObjectId | Filter by pipeline |
| `stageId` | ObjectId | Filter by stage |
| `source` | string | Lead source filter |
| `tags` | `tag1,tag2` | Comma-separated tags |
| `search`| string | Search in name, email, phone |
| `appointmentId` | ObjectId | Find lead linked to appointment |
| `page`, `limit` | number | Pagination (Default: 1, 25) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f1c...",
      "firstName": "Suresh",
      "lastName": "Rao",
      "phone": "+919876543210",
      "email": "suresh@example.com",
      "status": "open",
      "score": 85,
      "dealValue": 120000,
      "tags": ["hot", "high-intent"]
    }
  ],
  "total": 120
}
```

### `POST /api/crm/leads`
Create a new lead. Auto-bootstraps pipelines if none exist.

**Request Body:**
```json
{
  "firstName": "Jane",
  "phone": "+919999999999",
  "email": "jane@example.com",
  "source": "website",
  "dealValue": 50000,
  "metadata": {
    "refs": { "appointmentId": "6abc..." },
    "extra": { "plan": "Premium" }
  }
}
```

### `PATCH /api/crm/leads/:leadId/move`
Move lead to a different pipeline stage.

**Request Body:**
```json
{ "stageId": "6789abc..." }
```

### `PATCH /api/crm/leads/:leadId/tags`
Add or remove tags atomically.

**Request Body:**
```json
{ "add": ["vip"], "remove": ["cold"] }
```

### `POST /api/crm/leads/import`
Bulk upsert leads by phone (limit 1000).

**Request Body:**
```json
{
  "leads": [
    { "firstName": "A", "phone": "919000000001" },
    { "firstName": "B", "phone": "919000000002" }
  ]
}
```

---

## 4. CRM — Pipelines & Stages

### `GET /api/crm/pipelines`
Returns all pipelines with their stages.

### `POST /api/crm/pipelines`
Create a pipeline from a template (`sales` | `support` | `marketing`).

**Request Body:**
```json
{
  "name": "Course Sales",
  "template": "sales",
  "isDefault": true
}
```

### `GET /api/crm/pipelines/:pipelineId/board`
Kanban board aggregation (lead counts + total value per stage).

---

## 5. CRM — Activities & Notes

### `GET /api/crm/leads/:leadId/timeline`
Combined timeline of activities, calls, and notes.

### `POST /api/crm/leads/:leadId/notes`
Add a persistent note to a lead.

**Request Body:**
```json
{ "content": "Patient prefers evening consultations." }
```

---

## 6. WhatsApp Business API

**Base Path**: `/api/saas/chat`

### `POST /api/saas/chat/send`
Send a direct or template message.

**Request Body:**
```json
{
  "to": "+919876543210",
  "text": "Hello, your appointment is confirmed!",
  "templateName": "appointment_confirmed",
  "templateLanguage": "en_US"
}
```

### `POST /api/saas/chat/templates/sync`
Pull latest approved templates from Meta Business Manager.

### `PUT /api/saas/chat/templates/:templateName/mapping`
Map CRM lead fields to template variables.

**Request Body:**
```json
{
  "mappings": [
    { "variableIndex": 1, "source": "lead", "field": "firstName" },
    { "variableIndex": 2, "source": "event", "field": "doctorName" }
  ]
}
```

### `POST /api/saas/chat/broadcast`
Launch a bulk campaign.

**Request Body:**
```json
{
  "name": "Summer Health Camp",
  "templateName": "health_camp_invite",
  "recipients": [
    { "phone": "+919876543210", "variables": ["Ravi", "March 20"] }
  ]
}
```

---

## 6.1 Email Marketing — Campaigns

### `POST /api/saas/marketing/emails/campaign`
Asynchronously sends a mass email campaign to a list of recipients.

**Request Body:**
```json
{
  "recipients": ["user1@example.com", "user2@example.com"],
  "subject": "Summer Sale!",
  "html": "<h1>Huge discounts...</h1>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "_id": "65f1c...",
      "name": "Summer Sale!",
      "totalRecipients": 2,
      "status": "pending"
    },
    "message": "Campaign queued successfully"
  }
}
```

---

## 7. Google Meet Integration

### Create Meeting
`POST /api/saas/meet`

**Request Body:**
```json
{
  "leadId": "65f1e...",
  "participantName": "John Doe",
  "participantPhone": "919876543210",
  "startTime": "2024-03-20T10:00:00Z",
  "endTime": "2024-03-20T10:30:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "status": "scheduled"
  }
}
```

---

## 8. Monitoring & Health

### `GET /api/saas/health/client`
Returns tenant service connectivity.

**Response:**
```json
{
  "success": true,
  "data": {
    "services": {
      "whatsapp": "connected",
      "email": "configured",
      "googleMeet": "configured"
    },
    "emailMarketing": {
      "dailyLimit": 1000,
      "currentDayCount": 150,
      "hasFooter": true
    },
    "activeAutomations": 5
  }
}
```

### `GET /api/saas/events/logs`
Paginated history of automation executions.

---

## 9. Error Reference

| Code | Status | Meaning |
|------|--------|---------|
| `MISSING_REQUIRED` | 400 | Required fields (trigger, phone) are missing. |
| `INVALID_PHONE` | 400 | Phone number format is invalid (E.164 required). |
| `LEAD_NOT_FOUND` | 404 | Lead does not exist and auto-creation is disabled. |
| `DOMAIN_UNVERIFIED` | 422 | SES domain is not yet verified in AWS. |
| `UNAUTHORIZED` | 401 | API Key or Client Code is invalid. |
| `QUOTA_EXCEEDED` | 402 | Tenant daily sending limit reached. |
| `CAMPAIGN_FAILED` | 500 | Errors during bulk send orchestration. |
