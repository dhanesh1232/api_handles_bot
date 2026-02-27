<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# Security Policy

## Supported Versions

| Version       | Supported |
| ------------- | --------- |
| 1.x (current) | ✅ Active |

Older versions receive no security patches.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **security@ecodrix.com**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Your contact details (for follow-up)

We will acknowledge within **48 hours** and aim to release a patch within **7 days** for critical issues.

---

## Security Architecture

### Authentication Layers

| Layer      | Mechanism                             | Scope                                  |
| ---------- | ------------------------------------- | -------------------------------------- |
| Tenant API | `x-api-key` + `x-client-code` headers | All `/api/crm/*`, `/api/saas/*` routes |
| Admin API  | `verifyCoreToken` (JWT/Bearer)        | `/api/clients/*` routes only           |
| Public     | None                                  | `GET /api/saas/health` only            |

### Tenant Isolation

Every database query includes `clientCode` as a mandatory filter. Tenant data is physically isolated in separate MongoDB databases — one per client. A bug in query X for client A **cannot** leak client B's data.

> [!CAUTION]
> **Never** use the default Mongoose connection for tenant data. The default connection points to the central `services` DB. See `CONTRIBUTING.md` for enforcement patterns.

### Secrets Encryption

All per-client credentials (WhatsApp tokens, SMTP passwords, etc.) stored in `ClientSecrets` are encrypted at rest using **AES-256-CBC** with the server-side `ENCRYPTION_KEY`.

The `ENCRYPTION_KEY` is **never** stored in the database. If this key is compromised:

1. Rotate immediately (see `RUNBOOK.md` → Section 4)
2. Revoke all affected client API keys
3. Re-issue new credentials to clients

### Callback Signing

All outbound webhooks (callbacks to client URLs) are signed with a per-client `automationWebhookSecret` using **HMAC-SHA256**. Clients must verify the `x-ecodrix-signature` header before processing callbacks.

```http
x-ecodrix-signature: sha256=<hmac_hex_digest>
```

Verification example (Node.js):

```ts
import crypto from "crypto";

function verifyCallback(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### Rate Limiting

- **Global:** Applied to all `/api/*` routes
- **Trigger endpoint:** Stricter 60 requests/minute/tenant with IPv6-safe key generation

Rate limit state is currently **in-memory** (single process). If you scale to multiple processes, switch to a Redis or MongoDB-backed rate limit store.

### CORS

The allowed origins list is dynamic — managed via the `CorsOrigin` collection. Only origins explicitly added via `POST /api/saas/cors` (or the hardcoded list in `server.ts`) are permitted.

---

## Security Checklist for Production

- [ ] `ENCRYPTION_KEY` is exactly 32 characters and stored only in environment variables (not in code or DB)
- [ ] `CORE_API_TOKEN` is a strong random secret stored only in environment variables
- [ ] MongoDB Atlas Network Access is restricted to your server's static IP
- [ ] TLS is terminated at the reverse proxy (HTTPS only in production)
- [ ] `NODE_ENV=production` is set (disables stack traces in error responses)
- [ ] Per-client `automationWebhookSecret` values are unique, 32-char hex strings
- [ ] Clients are instructed never to expose their `x-api-key` in browser code

---

## Known Non-Issues

- **MongoQueue polling**: The queue polls MongoDB on a 5-second interval. This is intentional and not a vulnerability.
- **Socket.IO rooms by `clientCode`**: Rooms are joined server-side only — clients cannot join arbitrary rooms without server validation.
