/**
 * SDK barrel — single import point for all service class facades.
 *
 * Usage:
 *   import { createSDK } from "../sdk/index.ts";
 *
 *   const sdk = createSDK(clientCode, io);
 *
 *   const lead     = await sdk.lead.create({ firstName: "Raj", phone: "919..." });
 *   const all      = await sdk.pipeline.list();
 *   await sdk.activity.createNote(lead._id, "Follow up next week");
 *   await sdk.whatsapp.sendTemplate(convId, "welcome_msg");
 *
 * Each call to createSDK() is lightweight — the classes hold no persistent
 * state other than clientCode (and io for WhatsAppSDK).
 * You can create a new SDK instance per request, or cache it per clientCode.
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
 * Create a full SDK bound to a single clientCode.
 *
 * @param clientCode - Tenant identifier (e.g. "ACME_001")
 * @param io         - Socket.io Server instance, or null if not needed
 *
 * @example
 *   // In a route handler
 *   const sdk = createSDK(req.clientCode, io);
 *   const lead = await sdk.lead.create({ firstName: "Raj", phone: "91..." });
 *
 * @example
 *   // In a job / automation
 *   const sdk = createSDK(clientCode);  // io defaults to null
 *   await sdk.lead.move(leadId, wonStageId);
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
