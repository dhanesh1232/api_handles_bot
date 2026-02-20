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
