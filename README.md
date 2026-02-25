# ECOD Backend API (Logic Engine)

The **API Bot** is the core backend engine for ECOD, responsible for handling real-time communications, multi-tenant WhatsApp integration, background jobs, and dynamic database routing.

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

---

## 🏗 Key Components & Architecture

For a deep dive into the technical design, see the **[Architecture Guide](./ARCHITECTURE.md)**.

### 1. Unified CRM Automation (`src/routes/saas/crm/automation.routes.ts`)

- **Event-Driven**: Trigger workflows via `POST /api/crm/automations/events`.
- **Intelligent Routing**: Rules stored in the tenant DB define how to react to appointment confirms, payments, or lead changes.
- **Unified Jobs**: Actions (WhatsApp, Email, Meet) are enqueued into a central `services.jobs` collection for reliable background processing.

### 2. Multi-Tenant Communication Layer

- **WhatsApp Webhooks**: Managed in `src/routes/saas/whatsapp/webhook.routes.ts`.
- **Core Service**: `src/services/saas/whatsapp/whatsapp.service.ts` handles all outbound/inbound logic.
- **Identity Matching**: Decrypts client tokens to route payloads to the correct tenant database.

### 3. Connection Manager (`src/lib/connectionManager.ts`)

- Dynamically creates and caches tenant-specific MongoDB connections.
- **Data Isolation**: All CRM operations must use `get.crm.model.ts` to ensure data never leaks into the central DB.

---

## 🔒 Security & Auth

- **Encrypted Secrets**: Sensitive keys are AES-256 encrypted in the `services` database.
- **Middleware**: `verifyCoreToken` ensures requests provide a valid `x-api-key` and `x-client-code`.
- **JSON Guard**: Built-in protection against malformed or oversized payloads.

---

## 📂 Project Structure

```text
├── src/
│   ├── jobs/           # Unified background workers (crmWorker.ts)
│   ├── lib/            # Auth, Connection Manager, Encryption
│   ├── model/          # Schemas (Tenant-isolated CRM vs. Central Services)
│   ├── routes/         # API Endpoints (CRM, WhatsApp, Clients)
│   └── services/       # Core Logic (CRM, WhatsApp, Meet, Mail)
├── server.ts           # Entry point (Express + Socket.io + Cron + Workers)
├── ARCHITECTURE.md     # Technical Deep Dive
└── README.md           # This file
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

## 🔁 Unified CRM Automation System

The backend includes a **Centralized Job Queue** (MongoQueue) that handles multi-tenant automations.

### How it works

1. **Client project** fires a `POST /api/crm/automations/events` request.
2. **Backend** looks up active `AutomationRule` documents in the specific tenant's database.
3. **Execution**:
   - **Internal Updates** (Stage changes, tags): Handled instantly.
   - **External Actions** (WhatsApp, Meetings, Emails): Enqueued into the `services` DB as jobs.
4. **CRM Worker**: The `crmWorker.ts` polls the central queue and executes actions while switching DB context per-job.

### Trigger API

```
POST /api/crm/automations/events
Headers:
  x-api-key: <ERIX_CLIENT_API_KEY>
  x-client-code: <ERIX_CLIENT_CODE>
  Content-Type: application/json
```

#### Payload Example

```json
{
  "trigger": "appointment_confirmed",
  "phone": "918143963821",
  "variables": {
    "patientName": "Dhanesh",
    "doctorName": "Dr. Arjun",
    "time": "Monday 10AM"
  },
  "createLeadIfMissing": true,
  "leadData": { "source": "website" }
}
```

#### Supported Trigger Events

| Event                       | Description                                         |
| :-------------------------- | :-------------------------------------------------- |
| `appointment_confirmed`     | Fires after a billing/booking success.              |
| `product_purchased`         | Fires when an e-commerce order is paid.             |
| `service_enrolled`          | Fires on successful enrollment.                     |
| `form_submitted`            | Fires when a public landing page form is filled.    |
| `appointment_reminder`      | Used for scheduled follow-ups.                      |
| `deal_won` / `deal_lost`    | Triggered when a lead is moved to a win/loss stage. |
| `tag_added` / `tag_removed` | Triggered during lead segmentation.                 |

### Background Worker Configuration

The worker runs automatically on server start (`crmWorker.ts`). It polls the `services.jobs` collection every 5 seconds (default) and processes jobs with a concurrency of 3.

Jobs are stored in the `services` DB → `jobs` collection and visible for debugging.

---

## 📄 License

This software is proprietary and confidential.

Copyright © 2025 **ECODrIx**. All rights reserved.

Unauthorized copying, distribution, modification, or use of this software — in whole or in part — is strictly prohibited without prior written consent from ECODrIx. See the [LICENSE](./LICENSE) file for full terms.

---

## 📬 Contact

**ECODrIx**
🌐 [ecodrix.com](https://ecodrix.com)
✉️ legal@ecodrix.com
