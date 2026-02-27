<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# ECODrIx Backend — Operations Runbook

Operational playbook for admins, on-call engineers, and anyone managing the live system.

---

## 1. Onboarding a New Client

Complete these 8 steps in order. All steps use the admin API (`x-core-api-key` header with `CORE_API_TOKEN`).

```bash
BASE="https://api.ecodrix.com"
ADMIN_KEY="your_CORE_API_TOKEN"
```

### Step 1 — Create client record

```bash
curl -X POST "$BASE/api/clients" \
  -H "x-core-api-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Dr. Sharma Clinic", "email": "contact@sharmaclinic.com" }'
```

Response includes `clientCode` and `apiKey`. **Save both** — the apiKey is hashed after creation and cannot be retrieved again.

### Step 2 — Add client secrets

```bash
curl -X POST "$BASE/api/clients/sharmaclinic/secrets" \
  -H "x-core-api-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "whatsappToken": "...",
    "whatsappBusinessId": "...",
    "whatsappPhoneNumberId": "...",
    "whatsappWebhookToken": "...",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 465,
    "smtpUser": "clinic@gmail.com",
    "smtpPass": "...",
    "smtpFrom": "Dr. Sharma Clinic <clinic@gmail.com>",
    "automationWebhookSecret": "32-char-hex-string-here"
  }'
```

### Step 3 — Register tenant database

```bash
curl -X POST "$BASE/api/clients/sharmaclinic/datasource" \
  -H "x-core-api-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "dbUri": "mongodb+srv://..." }'
```

### Step 4 — Connect Google Meet (browser OAuth)

Open in browser as the client's Google account:

```
https://api.ecodrix.com/api/auth/google/connect?clientCode=sharmaclinic
```

### Step 5 — Sync WhatsApp templates

```bash
curl -X POST "$BASE/api/saas/chat/templates/sync" \
  -H "x-api-key: CLIENT_API_KEY" \
  -H "x-client-code: sharmaclinic"
```

### Step 6 — Add CORS origin (if client calls from browser)

```bash
curl -X POST "$BASE/api/saas/cors" \
  -H "x-api-key: CLIENT_API_KEY" \
  -H "x-client-code: sharmaclinic" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://sharmaclinic.com" }'
```

### Step 7 — Create at least one automation

```bash
curl -X POST "$BASE/api/crm/automations" \
  -H "x-api-key: CLIENT_API_KEY" \
  -H "x-client-code: sharmaclinic" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Appointment Confirmed WA",
    "trigger": "appointment_confirmed",
    "triggerConfig": {},
    "actions": [{
      "type": "send_whatsapp",
      "delayMinutes": 0,
      "config": { "templateName": "appointment_confirmed", "language": "en_US" }
    }]
  }'
```

### Step 8 — Share with client

Provide these four values securely (use 1Password, Vault, or encrypted email):

- `API_URL` = `https://api.ecodrix.com`
- `API_KEY` = the key from Step 1
- `CLIENT_CODE` = e.g. `sharmaclinic`
- `WEBHOOK_SECRET` = the `automationWebhookSecret` from Step 2

---

## 2. Inspecting & Managing the Job Queue

The MongoQueue stores jobs in the central `services` database (`jobs` collection).

### View pending / stuck jobs (MongoDB Atlas UI or mongosh)

```js
// Count by status
db.jobs.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);

// View stuck jobs (processing > 10 min)
db.jobs.find({
  status: "processing",
  updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
});
```

### Re-queue a stuck job

```js
// Reset a specific stuck job back to pending
db.jobs.updateOne(
  { _id: ObjectId("...") },
  { $set: { status: "pending", retries: 0 } },
);
```

### Kill a poison job permanently

```js
db.jobs.deleteOne({ _id: ObjectId("...") });
```

---

## 3. Revoking a Client API Key

```bash
# Generate new key
curl -X POST "$BASE/api/clients/sharmaclinic/rotate-key" \
  -H "x-core-api-key: $ADMIN_KEY"
```

Immediately invalidates the old key. The client must update their integration with the new key.

---

## 4. Rotating the ENCRYPTION_KEY

> [!CAUTION]
> This is a **dangerous, irreversible operation** if done incorrectly. All client secrets are encrypted with this key. Do this on a maintenance window.

**Procedure:**

1. **Decrypt all secrets** using the old key (write a one-off migration script).
2. Update `ENCRYPTION_KEY` in `.env`.
3. **Re-encrypt all secrets** with the new key and save back to the DB.
4. Restart the server.
5. Verify at least one client's API call still works.

There is no automated tooling for this — write a one-off script when needed.

---

## 5. Force Re-sync WhatsApp Templates for a Client

Use when a client has approved new templates in Meta Business Manager that haven't appeared in ECODrIx:

```bash
curl -X POST "$BASE/api/saas/chat/templates/sync" \
  -H "x-api-key: CLIENT_API_KEY" \
  -H "x-client-code: CLIENT_CODE"
```

---

## 6. Forcing a Lead Score Recalculation

If scoring rules changed and you need to recalculate all leads:

```bash
# Recalculate one lead
curl -X POST "$BASE/api/crm/scoring/LEAD_ID/recalculate" \
  -H "x-api-key: CLIENT_API_KEY" \
  -H "x-client-code: CLIENT_CODE"
```

For bulk recalculation, use MongoDB Atlas to trigger the cron job, or wait for the scheduled `score_recalculation` cron (runs nightly).

---

## 7. Checking Server Health

```bash
curl https://api.ecodrix.com/api/saas/health
```

If the server returns a non-200 or is unreachable:

1. Check PM2: `pm2 status`
2. Check PM2 logs: `pm2 logs ecodrix-backend --lines 200`
3. Check MongoDB Atlas → Network Access (IP whitelisted?)
4. Check Atlas cluster status (paused? M0 clusters auto-pause)

---

## 8. Common Errors & Fixes

| Error                        | Likely Cause                    | Fix                                           |
| ---------------------------- | ------------------------------- | --------------------------------------------- |
| `ClientCode not found`       | Client not onboarded            | Run onboarding steps 1–3                      |
| `No tenant connection for X` | `ClientDataSource` missing      | Run Step 3 of onboarding                      |
| `Invalid API key`            | Wrong key / rotated             | Re-share the correct key                      |
| `Template not found`         | Not synced yet                  | Run Step 5 (template sync)                    |
| `MongoNetworkError`          | Atlas IP blocked                | Whitelist server IP in Atlas                  |
| `HMAC mismatch` on callback  | Wrong `automationWebhookSecret` | Client must update their webhook verification |
| Job stuck in `processing`    | Worker crashed mid-job          | Reset job status — see Section 2              |

---

## 9. Deploying a New Version

See `DEPLOYMENT.md` → Section 9 (Zero-Downtime Deploys).

---

## 10. Offboarding a Client

```bash
# 1. Disable all automations (optional — just stops any trigger-initiated actions)
# 2. Delete the client record
curl -X DELETE "$BASE/api/clients/CLIENT_CODE" \
  -H "x-core-api-key: $ADMIN_KEY"

# 3. Drop the tenant database in MongoDB Atlas manually
# The backend does NOT auto-drop tenant databases on client deletion.
```
