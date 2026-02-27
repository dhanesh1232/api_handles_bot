# Changelog

All notable changes to the ECODrIx Backend will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.6.0] — 2026-02-27

### Added

- **Manual Sequence Enrollments**: New API routes under `/api/crm/sequences` for lead enrollment/unenrollment.
- **Google Meet Re-auth**: Triggered OAuth flow for refreshing expired or broken tokens.
- **Structured Automation Context**: Templates now support `lead`, `event`, and `resolved` namespaces.
- **Production Smoke Tests**: Automated suite in `src/tests/smoke.test.ts`.

### Fixed

- **Lead Creation Resilience**: Auto-bootstrapping of pipeline stages for brand-new tenants.
- **WhatsApp Webhook**: Verified Meta Cloud API connectivity and fixed GET verification challenge.
- **Google Meet Links**: Improved link extraction from `conferenceData` fallbacks.

---

## [1.0.0] — 2026-02-27

### Added

**Multi-Tenant Core**

- Dual-database architecture: central `services` DB + per-client tenant DBs
- `connectionManager.ts` — pooled tenant connection cache keyed by `clientCode`
- `getCrmModels()` shortcut for safe tenant model access
- `verifyCoreToken` middleware for admin-only routes
- `validateClientKey` middleware — verifies API key + attaches `clientCode` to every request

**Workflow Engine**

- `POST /api/saas/workflows/trigger` — single entry point for all client automation triggers
- 18 supported trigger names (`appointment_confirmed`, `payment_captured`, `lead_created`, etc.)
- `requiresMeet` flag — optional Google Meet link creation per trigger
- `callbackUrl` + HMAC-signed webhook delivery with retry (`callbackSender.ts`)
- `delayMinutes` — schedule automations up to N minutes in the future via MongoQueue
- `createLeadIfMissing` — auto-creates lead on trigger if phone not found
- `EventLog` — full audit trail for every trigger invocation

**CRM**

- Leads: create, list (with 14 filter/sort params), update, archive, tag, move, convert, bulk import
- Pipelines & Stages: CRUD, reorder, duplicate, board view (Kanban), revenue forecast
- Activities, Calls & Notes: full timeline, pin notes, log calls
- Automations: rule engine with 6 action types, condition filtering, dry-run test endpoint
- Analytics: 8 endpoints — overview KPIs, funnel, forecast, sources, team leaderboard, heatmap, score distribution, stage time
- Lead Scoring: configurable rule-based scoring, hot/cold thresholds, on-demand recalculation
- Auto-creates a default "sales" pipeline for brand-new tenants (prevents crashes on first trigger)

**WhatsApp**

- Inbound webhook: receive messages, statuses, reactions
- Outbound messaging: text, template, media
- Conversation management: list, create, read-mark, delete
- Template sync from Meta Business Manager
- Template variable mapping (CRM fields → template `{{1}}`, `{{2}}`, etc.)
- Template preview + validation
- Broadcast campaigns (bulk enqueue, non-blocking)
- Media upload via Cloudflare R2 (image/PDF/video with Sharp optimization)
- Real-time Socket.IO push for new messages and statuses
- Incoming WhatsApp messages auto-create or link to existing CRM Leads

**Background Jobs**

- `MongoQueue` — custom poll-based job queue (no Redis required)
- `crmWorker.ts` — single centralized worker for all async jobs
- Cron jobs: `no_contact` detection, nightly score recalculation
- Job types: `crm.automation_event`, `crm.send_whatsapp`, `crm.send_broadcast_msg`, `crm.send_email`, `crm.google_meet`

**Integrations**

- Google Meet: OAuth flow + meeting creation per trigger
- OpenAI: AI-assisted features (chatbot, text generation)
- SMTP email: per-client credentials via `ClientSecrets`
- Cloudflare R2: media storage + CDN delivery
- FFmpeg: video/audio transcoding for media messages

**Infrastructure**

- Helmet security headers
- Global + trigger-specific rate limiting (IPv6-safe)
- Dynamic CORS allowlist via `CorsOrigin` model + admin API
- Graceful shutdown on `SIGTERM` / `SIGINT`
- PM2 `ecosystem.config.cjs` for production process management
- `.github/workflows/` — CI (type-check, lint) + release pipeline
- Dependabot for automated dependency updates

### Security

- All client secrets encrypted at rest with AES-256 (`ENCRYPTION_KEY`)
- All outbound callbacks HMAC-signed with per-client `automationWebhookSecret`
- Tenant isolation enforced at every query level — `clientCode` is a hard filter
- Tenant models only registered on isolated tenant connections (never on the central connection)

---

_For older internal development history, see git log._
