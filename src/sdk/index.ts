/**
 * @file index.ts
 * @module SDKFactory
 * @responsibility Central entry point for initializing tenant-bound SDK instances.
 * @dependencies All sub-SDK classes (Lead, WhatsApp, Pipeline, etc.)
 *
 * @example
 *   const sdk = createSDK(clientCode, io);
 *   const lead = await sdk.lead.create({ firstName: "Raj", phone: "91..." });
 */

import type { Server } from "socket.io";
import { ActivitySDK } from "./activity.sdk.ts";
import { AutomationSDK } from "./automation.sdk.ts";
import { CacheSDK } from "./cache.sdk.ts";
import { JobSDK } from "./job.sdk.ts";
import { LeadSDK } from "./lead.sdk.ts";
import { MailSDK } from "./mail.sdk.ts";
import { MeetSDK } from "./meet.sdk.ts";
import { NotificationSDK } from "./notification.sdk.ts";
import { PipelineSDK } from "./pipeline.sdk.ts";
import { StorageSDK } from "./storage.sdk.ts";
import { WhatsAppSDK } from "./whatsapp.sdk.ts";

export { ActivitySDK } from "./activity.sdk.ts";
export { AutomationSDK } from "./automation.sdk.ts";
export { CacheSDK } from "./cache.sdk.ts";
export { JobSDK } from "./job.sdk.ts";
export { LeadSDK } from "./lead.sdk.ts";
export { MailSDK } from "./mail.sdk.ts";
export { MeetSDK } from "./meet.sdk.ts";
export { NotificationSDK } from "./notification.sdk.ts";
export { PipelineSDK } from "./pipeline.sdk.ts";
export { StorageSDK } from "./storage.sdk.ts";
export { WhatsAppSDK } from "./whatsapp.sdk.ts";

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Factory function to create a unified SDK instance bound to a tenant.
 *
 * **WORKING PROCESS:**
 * 1. Receives a `clientCode` (mandatory) and `io` (optional).
 * 2. Instantiates all sub-SDK classes (Lead, WhatsApp, Automation, etc.).
 * 3. Injects the `clientCode` into every sub-SDK to ensure tenant isolation.
 * 4. Returns a frozen-like object containing all service facades.
 *
 * @param {string} clientCode - Unique tenant identifier.
 * @param {Server | null} [io=null] - Optional Socket.io instance for real-time features.
 * @returns {SDK} A complete bound SDK instance.
 */
export function createSDK(clientCode: string, io: Server | null = null): SDK {
  return {
    lead: new LeadSDK(clientCode),
    pipeline: new PipelineSDK(clientCode),
    activity: new ActivitySDK(clientCode),
    whatsapp: new WhatsAppSDK(clientCode, io),
    media: new StorageSDK(clientCode),
    storage: new StorageSDK(clientCode),
    mail: new MailSDK(clientCode),
    meet: new MeetSDK(clientCode),
    automation: new AutomationSDK(clientCode),
    notification: new NotificationSDK(clientCode),
    jobs: new JobSDK(clientCode),
    cache: new CacheSDK(clientCode),
  };
}
