# ECODrIx API Bot (Logic Engine)

The **API Bot** is the core backend engine for ECODrIx, responsible for handling real-time communications, multi-tenant WhatsApp integration, background jobs, and dynamic database routing.

## 🚀 Core Responsibilities

1.  **Multi-tenant Webhook Handling**: Receives and routes WhatsApp messages from Meta Cloud API to the correct client database.
2.  **Advanced CRM (Multi-tenant)**: Each client has their own isolated Leads and Contacts management system.
3.  **Google Meet Integration**: Automated generation of meeting links for consultations and appointments.
4.  **Email Marketing & Campaigns**: Bulk email delivery using client-specific SMTP settings.
5.  **Real-time Synchronization**: Uses Socket.io to push updates instantly to dashboards.
6.  **Dynamic Database Routing**: Automatically establishes connections to tenant-specific MongoDB databases on demand.
7.  **Automated Workflows**: Manages lead follow-ups and appointment reminders via CRON jobs.
8.  **Media Processing**: Downloads and optimizes WhatsApp media for R2 storage.

## 🛠 Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Real-time**: Socket.io
- **Database**: MongoDB with Mongoose (Dual-layer: Services DB + Tenant DBs)
- **Storage**: Cloudflare R2 (via S3 SDK)
- **Task Scheduling**: node-cron

---

## 📚 Documentation

- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Guidelines for code standards, branching, and pull requests.
- **[.env.example](./.env.example)**: Reference for required environment variables.

---

## 🏗 Key Components & Logic Flow

### 1. WebHook Handler (`src/routes/saas/whatsapp/webhook.ts`)

- **Verification**: Handles Meta's verification challenge using client-specific tokens.
- **Ingestion**: Receives incoming JSON payloads from WhatsApp.
- **Matching**: Decrypts stored `whatsappPhoneNumberId` to identify which client the message belongs to.
- **Asynchronous Processing**: Responds with `200 OK` immediately and processes the message logic asynchronously to avoid blocking Meta's retries.

### 2. WhatsApp Service (`src/services/saas/whatsapp/whatsappService.ts`)

- **Message Parsing**: Handles Text, Images, Video, Documents, and Interactive Button Replies.
- **Reactions**: Managed via a priority-based status system to avoid out-of-order updates.
- **Outbound Engine**: Supports sending templates, media, and free-form text.

### 3. Connection Manager (`src/lib/connectionManager.js` & `tenantDb.js`)

- Ensures that client data is strictly isolated.
- Connections are cached to optimize performance while maintaining the ability to route requests across hundreds of different database URIs.

### 4. Automated Jobs (`src/jobs/`)

- `firstContactJob`: Flags leads that haven't been contacted within the required timeframe.
- `tenantRemindersJob`: Polls tenant databases for upcoming appointments and sends automated WhatsApp reminders using templates.

---

## 🔒 Security & Auth

- **Encrypted Secrets**: Sensitive keys (WhatsApp tokens, R2 credentials) are stored as encrypted strings using AES-256.
- **Middleware**: `validateClientKey` ensures only requests with a valid `x-api-key` and matching `x-client-code` can access tenant data.
- **JSON Guard**: `server.js` contains a custom parser to catch malformed JSON/Multipart requests gracefully.

---

## 📂 Project Structure

```text
├── src/
│   ├── jobs/           # Scheduled background tasks
│   ├── lib/            # Shared utilities (DB, WhatsApp, Encryption)
│   ├── middleware/     # Auth and validation logic
│   ├── model/          # Mongoose schemas (Services vs. Tenant)
│   ├── routes/         # API Endpoints (SaaS, Chat, Webhooks)
│   └── services/       # Business logic (WhatsApp, Media, Leads)
├── server.js           # Entry point (Express + Socket.io + Cron)
└── .env                # Core environment configurations
```

---

## 📝 Doable Things (Capabilities)

- [x] **Advanced CRM**: Isolated Lead/Contact management per tenant.
- [x] **Google Meet**: Dynamic meeting link generation.
- [x] **Email Marketing**: Multi-tenant SMTP campaign engine.
- [x] **Template Syncing**: Pulls approved WhatsApp templates directly from Meta.
- [x] **Media Archiving**: Automatically saves customer-sent media to your R2 storage.
- [x] **Read Receipts**: Real-time status updates (Sent -> Delivered -> Read).
- [x] **Lead Scoring**: Basic logic for scoring leads based on interaction quality.
- [x] **Dynamic Routing**: Add new clients simply by updating the `ClientSecrets` collection.

## 🛠 Development Commands

```bash
# Start the bot
pnpm start

# Run in development mode
pnpm dev

# Run linting
pnpm run lint

# Auto-fix formatting and linting issues
pnpm run format
```

## 🧹 Linting & Formatting

This project uses **ESLint** (Flat Config) and **Prettier** to maintain code quality and consistent style.

- **Linting**: Checks for potential errors and unused variables.
- **Formatting**: Automatically fixes indentation, quotes, and spacing.

---

## 🔁 Workflow Trigger System

The backend includes a **MongoDB-backed job queue** (no Redis required) that handles delayed WhatsApp automations across all tenants.

### How it works

1. **Client project** fires a `POST /api/saas/workflows/trigger` request when an event occurs (payment success, booking, enrollment, etc.)
2. **Backend** looks up the active `CommunicationWorkflow` rules for that trigger in the client's tenant DB
3. **Instant workflows** (`delayMinutes: 0`) → executed immediately
4. **Delayed workflows** → job stored in the central `services` DB, worker picks it up at the right time
5. After execution, the backend optionally calls back the client's `callbackUrl` to update state

### Client Setup (per project)

Add these to the client Next.js project `.env`:

```env
ERIX_SOCKET_URL=https://your-ecod-backend.com
ERIX_CLIENT_CODE=CLIENTNAME          # unique code per client (uppercase)
ERIX_CLIENT_API_KEY=their-api-key    # stored in ECOD ClientSecrets collection
```

In ECOD backend (one-time per client):
1. Create `ClientDataSource` pointing to their MongoDB URI
2. Create `ClientSecrets` with their `whatsappToken` + `whatsappPhoneNumberId`
3. Create `CommunicationWorkflow` rules in their tenant DB (via the workflow API or directly)

### Trigger API

```
POST /api/saas/workflows/trigger
Headers:
  x-api-key: <ERIX_CLIENT_API_KEY>
  x-client-code: <ERIX_CLIENT_CODE>
  Content-Type: application/json
```

#### Payload

```jsonc
{
  "trigger": "appointment_confirmed",   // see Trigger Events below
  "phone": "918143963821",              // E.164 format, digits only
  "variables": ["Dhanesh", "Dr. Arjun", "Monday 10AM", "abc-xyz"],  // WhatsApp template vars
  "conversationId": "optional-id",      // skip to auto-create conversation

  // For delayed/scheduled workflows (optional)
  "baseTime": "2026-02-23T10:00:00Z",   // reference timestamp
  "delayMinutes": -60,                  // relative to baseTime (-60 = 1h before)

  // Callback — backend will PUT this URL after execution (optional)
  "callbackUrl": "https://yoursite.com/api/workflows/callback",
  "callbackMetadata": {
    "moduleId": "appt_id_here",
    "moduleType": "Appointment",
    "reminderKey": "1h"
  }
}
```

#### Trigger Events

| Event | When to fire |
|---|---|
| `appointment_confirmed` | After appointment is booked and paid |
| `appointment_reminder` | Use with `delayMinutes: -60` or `-15` for reminders |
| `appointment_cancelled` | When appointment is cancelled |
| `appointment_rescheduled` | When appointment time changes |
| `product_purchased` | After order payment is confirmed |
| `service_enrolled` | After service enrollment payment is confirmed |
| `lead_captured` | When a new lead fills a form |

#### Example — appointment confirmation + reminder chain

```ts
const headers = {
  "Content-Type": "application/json",
  "x-api-key": process.env.ERIX_CLIENT_API_KEY,
  "x-client-code": process.env.ERIX_CLIENT_CODE,
};

const callbackUrl = `${process.env.NEXT_PUBLIC_WEBSITE_URL}/api/workflows/callback`;
const variables = [patientName, doctorName, `${date} at ${timeSlot}`, meetCode];

// 1. Instant confirmation
await fetch(`${process.env.ERIX_SOCKET_URL}/api/saas/workflows/trigger`, {
  method: "POST", headers,
  body: JSON.stringify({
    trigger: "appointment_confirmed",
    phone: patientPhone,
    variables,
    callbackUrl,
    callbackMetadata: { moduleId, moduleType: "Appointment", reminderKey: "confirmed" },
  }),
});

// 2. 1-hour reminder (fires automatically 1h before appointment)
await fetch(`${process.env.ERIX_SOCKET_URL}/api/saas/workflows/trigger`, {
  method: "POST", headers,
  body: JSON.stringify({
    trigger: "appointment_reminder",
    phone: patientPhone,
    baseTime: appointmentDate,     // ISO date string
    delayMinutes: -60,
    variables,
    callbackUrl,
    callbackMetadata: { moduleId, moduleType: "Appointment", reminderKey: "1h" },
  }),
});
```

#### Callback endpoint (client side)

The backend will make a `PUT` request to your `callbackUrl` after execution:

```ts
// app/api/workflows/callback/route.ts
export async function PUT(req: Request) {
  const { status, metadata } = await req.json();
  const { moduleId, moduleType, reminderKey } = metadata;

  if (moduleType === "Appointment") {
    await Appointment.findByIdAndUpdate(moduleId, {
      $set: { [`remindersSent.${reminderKey}`]: true },
    });
  }
  return Response.json({ success: true });
}
```

### CommunicationWorkflow Rules

Workflows must be configured per client in their tenant DB. Example document:

```jsonc
{
  "name": "Appointment Confirmation",
  "trigger": "appointment_confirmed",
  "channel": "whatsapp",
  "templateName": "appointment_confirmed_v2",  // must exist in Meta template library
  "delayMinutes": 0,                            // 0 = instant
  "isActive": true
}
```

### Test via CLI

```bash
# Instant send
pnpm test:worker \
  --clientCode ERIX_CLNT1 \
  --phone 918143963821 \
  --template appointment_confirmed \
  --watch

# Delayed (5 minutes)
pnpm test:worker \
  --clientCode ERIX_CLNT1 \
  --phone 918143963821 \
  --template appointment_confirmed \
  --delay 300 \
  --watch
```

`--watch` polls the job status every 3s until `completed` or `failed`.

### Worker Configuration

The worker runs automatically when the server starts (`server.js` → `startWorkflowProcessor()`).

| Setting | Default | Description |
|---|---|---|
| `concurrency` | 3 | Max parallel jobs |
| `pollIntervalMs` | 10,000ms | How often DB is polled |
| `baseBackoffMs` | 5,000ms | Base for exponential retry (5s × 2ⁿ) |
| `maxAttempts` | 3 | Attempts before job is marked `failed` |

Jobs are stored in the `services` DB → `jobs` collection and visible for debugging.

