<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# Contributing to ECODrIx Backend

This guide ensures all contributors maintain the standards required for a production-grade multi-tenant system.

---

## Setup

```bash
# Clone and install
pnpm install

# Copy env
cp .env.example .env

# Start with hot reload
pnpm run dev

# Type check
pnpm run type-check

# Format
pnpm run format
```

---

## Core Rules

### 1. Tenant Isolation — Non-Negotiable

**Always** use `getCrmModels(clientCode)` for CRM data. **Never** use the default Mongoose connection for tenant data.

```typescript
// ✅ Correct
const { Lead } = await getCrmModels(clientCode);
const lead = await Lead.findById(id);

// ❌ Wrong — this writes to the central "services" DB
import { Lead } from "../model/saas/crm/lead.model.ts";
const lead = await Lead.findById(id);
```

### 2. Every Tenant Query Must Include `clientCode`

```typescript
// ✅ Safe
await Lead.findOne({ _id: id, clientCode });

// ❌ Dangerous — could return another tenant's data
await Lead.findById(id);
```

### 3. Automation Failures Must Never Crash Core Flows

```typescript
// ✅ Safe — automation is non-blocking
void fireAutomations(clientCode, ctx);

// ❌ Dangerous — if automation throws, lead creation fails too
await runAutomations(clientCode, ctx);
```

### 4. Schema Files Export Schemas, Not Models

```typescript
// ✅ Export schema only
export const ConversationSchema = new Schema({ ... });

// ❌ Never export a compiled model from tenant.schemas.ts
export const Conversation = mongoose.model("Conversation", schema);
// ^ This would bind to the default connection, not the tenant's
```

---

## API Response Format

All routes must return the unified envelope. No exceptions.

```typescript
// Success
res.json({ success: true, data: result });

// Created
res.status(201).json({ success: true, data: result });

// Validation error
res.status(400).json({ success: false, message: "fieldName is required" });

// Not found
res.status(404).json({ success: false, message: "Resource not found" });

// Server error
res.status(500).json({ success: false, message: err.message });
```

---

## Adding a New Route

1. **Create the route file** in `src/routes/saas/` or `src/routes/services/`
2. **Use JSDoc comments** above every handler with endpoint path, method, body shape, and response example
3. **Mount it in `server.ts`** with the correct middleware:
   - Tenant route → `validateClientKey`
   - Admin route → `verifyCoreToken`
4. **Document it in README.md** under the correct section

**Route handler template:**

```typescript
/**
 * POST /api/crm/example
 * Brief description.
 * Body: { field: string }
 */
router.post("/example", async (req: Request, res: Response) => {
  try {
    const clientCode = req.clientCode!;
    const { field } = req.body;

    if (!field) {
      res.status(400).json({ success: false, message: "field is required" });
      return;
    }

    const result = await myService.doThing(clientCode, field);
    res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});
```

---

## Adding a Background Job

Jobs are dispatched via `crmQueue.add()` and handled in `crmWorker.ts`.

```typescript
// Dispatch (from a route or service)
await crmQueue.add({
  clientCode,
  type: "crm.my_new_job",
  payload: { leadId: "...", data: "..." },
});

// Handle (in crmWorker.ts — add a new case)
case "crm.my_new_job": {
  const { leadId } = job.payload;
  await myService.doHeavyWork(clientCode, leadId);
  break;
}
```

> [!IMPORTANT]
> All job handlers must be idempotent — the queue may retry a job on failure.

---

## Commit Message Convention

```
feat(crm): add stage time analytics endpoint
fix(trigger): surface meet creation failure in response
refactor(lead): auto-create default pipeline for new tenants
docs(readme): add pipeline and scoring API reference
chore(deps): upgrade express-rate-limit to 8.2.1
```

---

## API Surface Quick Reference

The following modules exist. See `README.md` for detailed endpoint docs.

| Module                 | Base Path                  | Auth                         |
| ---------------------- | -------------------------- | ---------------------------- |
| Workflow Triggers      | `/api/saas/workflows`      | `validateClientKey`          |
| CRM Leads              | `/api/crm`                 | `validateClientKey`          |
| CRM Sequences          | `/api/crm/sequences`       | `validateClientKey`          |
| CRM Pipelines & Stages | `/api/crm`                 | `validateClientKey`          |
| CRM Activities & Notes | `/api/crm`                 | `validateClientKey`          |
| CRM Automations        | `/api/crm`                 | `validateClientKey`          |
| CRM Analytics          | `/api/crm`                 | `validateClientKey`          |
| Lead Scoring           | `/api/crm`                 | `validateClientKey`          |
| WhatsApp Chat          | `/api/saas/chat`           | `validateClientKey`          |
| WhatsApp Templates     | `/api/saas/chat/templates` | `validateClientKey`          |
| WhatsApp Webhooks      | `/api/saas/whatsapp`       | `validateClientKey`          |
| Event Logs             | `/api/saas/events`         | `validateClientKey`          |
| Callback Logs          | `/api/saas/callbacks`      | `validateClientKey`          |
| Health                 | `/api/saas/health`         | Public / `validateClientKey` |
| Admin Clients          | `/api/clients`             | `verifyCoreToken`            |

---

## License

Copyright © 2026 ECODrIx. All rights reserved.
