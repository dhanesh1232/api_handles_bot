# ECODrIx Backend API

Multi-tenant business automation engine. Clients integrate via REST API.
Think Twilio/SendGrid — API engine, not a dashboard product.

## Authentication

All API calls require:
x-api-key: <client_api_key>
x-client-code: <client_code>

## Core Endpoint

POST /api/saas/workflows/trigger
Fire a named event. ECODrIx runs matching automations.
Supports: Google Meet generation, callbacks, delayed execution,
multi-step sequences, WhatsApp templates, email.

## Monitoring

```
GET /api/saas/health → public health check
GET /api/saas/health/client → client service status (auth required)
GET /api/saas/events/logs → automation event history
GET /api/saas/events/stats → summary statistics
GET /api/saas/callbacks/logs → callback delivery history
GET /api/saas/jobs/status/:jobId → specific job status
```

## CRM

```
GET /api/crm/leads → leads list (filter/sort/paginate)
GET /api/crm/leads/:id/timeline → lead activity timeline
GET /api/crm/analytics/overview → KPIs
POST /api/crm/automations → create automation rule
GET /api/crm/automations → list rules
```

## WhatsApp

```
GET /api/saas/chat/conversations → inbox
GET /api/saas/chat/conversations/:id/messages → messages
POST /api/saas/chat/send → send message
POST /api/saas/chat/broadcast → bulk broadcast
```

## Callback Verification (for client websites)

ECODrIx signs all callbacks with HMAC-SHA256:

```javascript
const sig = req.headers["x-ecodrix-signature"]; // "sha256=<hex>"
const expected =
  "sha256=" +
  crypto
    .createHmac("sha256", YOUR * WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
if (sig === expected) {
  /* verified \_/*/
}
```

---

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

```markdown
- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Real-time**: Socket.io
- **Database**: MongoDB with Mongoose (Dual-layer: Services DB + Tenant DBs)
- **Storage**: Cloudflare R2 (via S3 SDK)
- **Task Scheduling**: node-cron
```

---

## ☁️ Deployment (Render)

The project is natively configured to deploy on **Render.com**. You can use the included `render.yaml` blueprint or configure it manually via the dashboard:

- **Build Command**: `pnpm install && pnpm run build`
  - _This installs dependencies and compiles TypeScript to highly optimized JavaScript in the `/dist` folder._
- **Start Command**: `pnpm start`
  - _Executes the compiled JS payload fast and cleanly (`node dist/server.js`)._

**Important Render Environment Variables:**

- `NODE_VERSION`: `22.18.0`
- `PNPM_VERSION`: `10.30.1`

## 🧹 Linting & Formatting

This project uses **ESLint** (Flat Config) and **Prettier** to maintain code quality and consistent style.

- **Linting**: Checks for potential errors and unused variables.
- **Formatting**: Automatically fixes indentation, quotes, and spacing.

---

## License

This software is proprietary and confidential.

Copyright © 2026 **ECODrIx**. All rights reserved.

Unauthorized copying, distribution, modification, or use of this software — in whole or in part — is strictly prohibited without prior written consent from ECODrIx. See the [LICENSE](./LICENSE) file for full terms.
