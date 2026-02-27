<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# ECODrIx Backend — Deployment Guide

This document covers everything required to run the ECODrIx backend in production.

---

## Prerequisites

| Requirement   | Minimum Version          |
| ------------- | ------------------------ |
| Node.js       | 18 LTS                   |
| pnpm          | 9.x                      |
| MongoDB Atlas | M10+ (dedicated cluster) |
| PM2           | 5.x (process manager)    |
| Cloudflare R2 | — (media storage)        |

---

## 1. Environment Variables

Copy the example and fill every variable before starting:

```bash
cp .env.example .env
```

### Required — Server Boot

| Variable          | Description                                                                          |
| ----------------- | ------------------------------------------------------------------------------------ |
| `PORT`            | Express listen port (default: `4000`)                                                |
| `NODE_ENV`        | `production`                                                                         |
| `MONGODB_URI`     | Atlas connection string prefix (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/`) |
| `MONGODB_URI_END` | Atlas connection string suffix (e.g. `?retryWrites=true&w=majority`)                 |
| `ENCRYPTION_KEY`  | Exactly **32 characters** — used for AES-256 encryption of client secrets            |
| `CORE_API_TOKEN`  | Admin JWT secret — used by `verifyCoreToken` on `/api/clients/*` routes              |

> [!CAUTION]
> `ENCRYPTION_KEY` cannot be changed after you've stored any client secrets. Rotating it requires decrypting + re-encrypting all tenant secrets. See `RUNBOOK.md`.

### Required — Integrations

| Variable                 | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `WHATSAPP_VERIFY_TOKEN`  | Custom token for Meta webhook verification                                          |
| `META_CLOUD_API_VERSION` | Meta Graph API version (e.g. `v20.0`)                                               |
| `OPENAI_API_KEY`         | OpenAI key (used for AI features)                                                   |
| `GOOGLE_CLIENT_ID`       | Google OAuth client ID (Google Meet)                                                |
| `GOOGLE_CLIENT_SECRET`   | Google OAuth client secret (Google Meet)                                            |
| `GOOGLE_REDIRECT_URI`    | Google OAuth callback URL (e.g. `https://api.ecodrix.com/api/auth/google/callback`) |
| `BASE_URL`               | Public base URL of this API (e.g. `https://api.ecodrix.com`)                        |

### Required — Storage (Cloudflare R2)

| Variable               | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `R2_ACCESS_KEY_ID`     | R2 API access key                                      |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key                                      |
| `R2_ENDPOINT`          | R2 endpoint URL                                        |
| `R2_BUCKET_NAME`       | Bucket name                                            |
| `R2_PUBLIC_URL`        | Public CDN base URL (e.g. `https://media.ecodrix.com`) |

### Optional — SMTP (per-client, stored in DB; these are fallback global creds)

| Variable    | Description       |
| ----------- | ----------------- |
| `SMTP_HOST` | SMTP host         |
| `SMTP_PORT` | SMTP port         |
| `SMTP_USER` | SMTP username     |
| `SMTP_PASS` | SMTP app password |

---

## 2. Build

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Type check before building
pnpm run type-check

# Compile TypeScript → dist/
pnpm run build
```

Output: `dist/server.js` + all compiled sources in `dist/`.

---

## 3. Process Manager (PM2)

Install PM2 globally:

```bash
pnpm add -g pm2
```

Start using the provided config:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup   # auto-start on reboot
```

**Key PM2 commands:**

```bash
pm2 status                          # health overview
pm2 logs ecodrix-backend --lines 100  # tail logs
pm2 reload ecodrix-backend          # zero-downtime reload
pm2 stop ecodrix-backend            # stop gracefully
pm2 monit                           # live CPU / memory dashboard
```

> [!IMPORTANT]
> The PM2 config sets `instances: 1` (fork mode). Do **not** increase instances without adding a Redis adapter to Socket.IO. The MongoQueue worker polls in-process — multiple instances will cause duplicate job execution.

---

## 4. Reverse Proxy (Nginx)

Example Nginx config for `api.ecodrix.com`:

```nginx
server {
    listen 443 ssl;
    server_name api.ecodrix.com;

    ssl_certificate     /etc/letsencrypt/live/api.ecodrix.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ecodrix.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;

        # WebSocket / Socket.IO support
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

> [!NOTE]
> The server calls `app.set("trust proxy", 1)` — this is required when behind Nginx to correctly read client IPs for rate limiting.

---

## 5. MongoDB Atlas Setup

1. **Create a `services` database** on your Atlas cluster — this is the central DB.
2. Set `MONGODB_URI` + `MONGODB_URI_END` to point to this cluster.
3. The backend constructs per-client URIs as: `${MONGODB_URI}${clientCode}${MONGODB_URI_END}`.
4. Whitelist your server's static IP in Atlas Network Access.
5. Create a DB user with `readWrite` on all databases (tenants are dynamically created).

**Atlas indexes to create on the `services` DB:**

```js
// clients collection
db.clients.createIndex({ clientCode: 1 }, { unique: true });
db.clients.createIndex({ apiKey: 1 });

// jobs collection (MongoQueue)
db.jobs.createIndex({ status: 1, runAt: 1 });
db.jobs.createIndex({ type: 1, status: 1 });
```

---

## 6. Cloudflare R2 Setup

1. Create a bucket with **private** access.
2. Create an R2 API token with **Object Read & Write** permission.
3. Set `R2_PUBLIC_URL` to your custom domain pointing to the R2 bucket (Cloudflare → R2 → Settings → Custom Domain).
4. Add a CORS policy to the bucket to allow uploads from your frontend domains.

---

## 7. WhatsApp Webhook Registration

After the server is live at `https://api.ecodrix.com`:

1. Go to Meta for Developers → Your App → WhatsApp → Configuration.
2. Set **Callback URL** to: `https://api.ecodrix.com/api/saas/whatsapp/webhook`
3. Set **Verify Token** to the value of `WHATSAPP_VERIFY_TOKEN` in your `.env`.
4. Subscribe to: `messages`, `message_deliveries`, `message_reads`.

---

## 8. Health Check

Verify the server is running:

```bash
curl https://api.ecodrix.com/api/saas/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 12345,
    "db": "connected",
    "version": "1.0.0",
    "env": "production"
  }
}
```

---

## 9. Zero-Downtime Deploys

```bash
# 1. Pull new code
git pull origin main

# 2. Install deps (no lockfile changes)
pnpm install --frozen-lockfile

# 3. Build
pnpm run build

# 4. Reload (PM2 restarts with new dist/, handles in-flight requests)
pm2 reload ecodrix-backend
```

---

## 10. Log Management

PM2 writes logs to `./logs/`. Set up log rotation:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

For centralized log shipping, pipe PM2 logs to **Axiom**, **Logtail**, or **Datadog** via their respective agents.
