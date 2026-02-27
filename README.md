<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# ECODrIx Backend API Engine

ECODrIx is a **Multi-tenant Business Automation Engine**. It is an API-first platform built for client websites to integrate directly via REST API. Think of it like Twilio or SendGrid — a powerful backend engine, not a dashboard product.

---

## 🔐 Authentication

All API calls to operational endpoints require strict tenant authentication headers:

```http
x-api-key: <client_api_key>
x-client-code: <client_code>
```

> [!IMPORTANT]
> The `x-client-code` forces the system to securely route your request to your isolated tenant database. Always keep your `x-api-key` secret in your server environment variables.

---

## 🚀 Core Features & API Reference

All successful API responses follow a strict, unified JSON format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

Errors are consistently formatted:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "code": "ERROR_CODE"
}
```

### 1. Trigger Automation Workflows

Fire a named event from your client application. ECODrIx will automatically run matching automations (e.g., sending WhatsApp messages, generating Google Meet links, delaying execution).

**Endpoint:** `POST /api/saas/workflows/trigger`  
_(Rate Limited: 60 requests / minute / tenant)_

**Request Payload Example:**

```json
{
  "trigger": "form_submitted",
  "phone": "919876543210",
  "email": "user@example.com",
  "delayMinutes": 0,
  "requiresMeet": true,
  "meetConfig": {
    "title": "Consultation",
    "durationMinutes": 30
  },
  "variables": {
    "name": "John Doe",
    "source": "website_pricing_page"
  },
  "callbackUrl": "https://your-server.com/webhook"
}
```

**Response Example:**

```json
{
  "success": true,
  "data": {
    "eventLogId": "65b2...",
    "trigger": "form_submitted",
    "leadId": "65b2...",
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "rulesMatched": 2,
    "scheduled": false
  }
}
```

### 2. Monitoring & Health

Query telemetry to monitor your live API usage, callbacks, and system configurations.

- **`GET /api/saas/health/client`**
  Check the status of your connected integrations (WhatsApp, Email Provider, Google Meet) and current background queue depth.
- **`GET /api/saas/events/logs`**
  Fetch a paginated history of automation events triggered manually or externally.
- **`GET /api/saas/events/stats`**
  Summary statistics of processed triggers vs. failures.
- **`GET /api/saas/callbacks/logs`**
  Validate the delivery history of callbacks sent to your configured `callbackUrl`.

### 3. Messaging (WhatsApp)

Interact directly with your isolated WhatsApp inbox and dispatch outbound messages.

- **`POST /api/saas/chat/send`**
  Send an outbound message or template to a phone number.
- **`POST /api/saas/chat/broadcast`**
  Dispatch mass marketing campaigns to thousands of users simultaneously via the background worker.
- **`GET /api/saas/chat/conversations`**
  Fetch your shared inbox conversations.
- **`GET /api/saas/chat/conversations/:id/messages`**
  Load the message history for a specific conversation.

### 4. Headless CRM

Manage the isolated CRM entities for your tenant programmatically.

- **`GET /api/crm/leads`** → List, filter, sort, and paginate CRM contacts.
- **`GET /api/crm/leads/:id/timeline`** → View the complete timeline of a lead's activity.
- **`GET /api/crm/analytics/overview`** → Fetch KPIs and pipeline stage distributions.
- **`GET /api/crm/automations`** → List currently active automation schemas.

---

## 🔗 Client Integration Example (Next.js / Node.js)

Here is how you would securely trigger an ECODrIx automation from your own server backend after a user submits a form on your site:

```javascript
// Example in a Next.js API Route or Express controller
export async function POST(request) {
  const userForm = await request.json();

  const response = await fetch(
    "https://api.ecodrix.com/api/saas/workflows/trigger",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ECODRIX_API_KEY,
        "x-client-code": process.env.ECODRIX_CLIENT_CODE,
      },
      body: JSON.stringify({
        trigger: "new_signup",
        phone: userForm.phone,
        email: userForm.email,
        variables: {
          firstName: userForm.firstName,
        },
      }),
    },
  );

  const exactMapping = await response.json();
  if (!exactMapping.success) {
    console.error("Failed to trigger flow:", exactMapping.message);
  }

  return Response.json({ status: "ok" });
}
```

### Callback Verification (Webhooks)

If you provide a `callbackUrl` in your trigger, ECODrIx will POST updates back to your server. ECODrIx strictly signs all callbacks with HMAC-SHA256 to ensure authenticity:

```javascript
import crypto from "crypto";

function verifyEcodrixWebhook(req) {
  const signature = req.headers["x-ecodrix-signature"]; // Format: "sha256=<hex>"
  const webhookSecret = process.env.ECODRIX_WEBHOOK_SECRET;

  const expectedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", webhookSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");

  return signature === expectedSignature;
}
```

---

## 🛠 Tech Stack

- **Runtime**: Node.js v22 (ES Modules / TypeScript Native via `tsx`)
- **Framework**: Express.js
- **Real-time Engine**: Socket.io
- **Database Architecture**: Multi-Tenant MongoDB (Mongoose) with Dynamic Routing
- **Background Jobs**: Centralized `MongoQueue` Worker Layer
- **Media Optimization**: Sharp & FFmpeg direct to Cloudflare R2 object storage

---

## 🧹 Linting & Formatting

This project enforces strong typing and unified formatting using tools specifically geared for enterprise scale:

- `pnpm run type-check`: Verifies the entire TS node map natively (`tsc --noEmit`).
- `pnpm run format`: Prettier passes on code format.

---

## License

This software is proprietary and confidential.

Copyright © 2026 **ECODrIx**. All rights reserved.

Unauthorized copying, distribution, modification, or use of this software — in whole or in part — is strictly prohibited without prior written consent from ECODrIx. See the [LICENSE](./LICENSE) file for full terms.
