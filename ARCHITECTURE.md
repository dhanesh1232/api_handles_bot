# ECOD Backend Architecture Guide

This document outlines the core technical architecture of the ECOD backend, focusing on multi-tenancy, automation engine, and background job processing.

---

## 1. High-Level Overview

ECOD is built as a **Multi-Tenant Communication & CRM Platform**. It uses a "Federated Storage" model where shared system data lives in a central database, while client-specific data is isolated in separate tenant databases.

### Key Technologies

- **Runtime**: Node.js (TypeScript)
- **Database**: MongoDB (Mongoose)
- **Real-time**: Socket.io
- **Processing**: MongoQueue (Custom poll-based queue)
- **Media**: Sharp (Images) & FFmpeg (Video/Audio)

---

## 2. Multi-Tenancy Architecture

We enforce **Strict Data Isolation** to ensure one tenant's data can never leak into another's or into the central system.

### The Dual-Database Approach

1.  **Central DB (`services`)**:
    - Stores global entities: `Client`, `User`, `ClientDataSource`, `Job`, `Secret`.
    - Manages API keys and tenant connection strings.
2.  **Tenant DB (Dynamic)**:
    - Each client has their own MongoDB database.
    - Stores: `Lead`, `Pipeline`, `Conversation`, `Message`, `AutomationRule`, `Activity`.

### Multi-Tenant Safeguards

To prevent accidental data leakage, we do **not** export compiled Mongoose models from schema files.

- **File**: `src/lib/tenant/get.crm.model.ts`
- **Mechanism**: Every service call must request models bound to a `clientCode`. This ensures that `mongoose.model()` is called on a tenant-specific connection, not the default one.

```typescript
// Correct Usage
const { Lead } = await getCrmModels(clientCode);
const lead = await Lead.findById(...);
```

---

## 3. CRM & Automation Engine

The automation engine is a unified system that reacts to events and executes multi-step workflows.

### Triggers

- **Internal**: Hooked into `lead.service.ts` lifecycle (e.g., `lead_created`, `stage_enter`).
- **External**: Triggered via `POST /api/crm/automations/events` for business events like `appointment_confirmed`.

### Workflow Execution

1.  **Rule Match**: When an event fires, the system queries the tenant's `AutomationRule` collection.
2.  **Action Dispatch**:
    - **Immediate**: Executed in-process if low-latency (e.g., tag addition).
    - **Delayed/External**: Enqueued as a **Job** for background processing.

---

## 4. Background Processing (Centralized Job Queue)

We use a custom, robust polling queue called **MongoQueue**.

### Why Centralized Jobs?

All jobs across all 100+ tenants are stored in the **central `services.jobs` collection**.

- **Efficiency**: A single worker cluster can poll one collection instead of 100+.
- **Monitoring**: Admins can see the global health of the system from one place.

### The `crmWorker.ts` Flow

1. **Poll**: The worker finds a waiting job in `services.jobs`.
2. **Context Load**: The worker extracts the `clientCode` from the job payload.
3. **Tenant Connect**: The worker establishes a connection to the specific tenant's DB.
4. **Execute**: It performs the action (Send WhatsApp, Create Meeting, etc.).

---

## 5. Feature Deep Dives

### WhatsApp Integration

- **Webhooks**: Handles incoming messages, status updates (delivered/read), and media downloads.
- **Templates**: Syncs with Meta's Graph API.
- **Automation**: Workflows can send templates automatically with dynamic variables.

### Media Processing

- Located in `src/services/saas/media/media.service.ts`.
- Automatically compresses images and encodes audio into WhatsApp-compatible formats (Opus/OGG).

---

## 6. Directory Structure

- `src/lib/`: Core utilities (Auth, DB Connections, Query Helpers).
- `src/model/`:
  - `clients/`: Central system models.
  - `saas/`: Tenant-specific schemas (Isolated).
- `src/services/`: Business logic layer.
- `src/jobs/`: Background workers and queue definitions.
- `src/routes/`: Express API endpoints.

---

## 7. Developer Guidelines

1.  **Never Use Default Connection**: Avoid `import { Lead } from ...`. Always use `getCrmModels(clientCode)`.
2.  **Atomic Services**: Keep service functions focused on one entity.
3.  **Fail Fast**: Use Zod or interface checks at the boundary of every external API call.
4.  **Security**: Always verify `x-api-key` and `x-client-code` in the route layer using `verifyCoreToken`.
