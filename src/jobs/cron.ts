import cron from "node-cron";
import {
  autoCloseJob,
  firstContactJob,
  followUpJob,
  followUpLimitJob,
  remindersJob,
  researchJob,
  templateSyncJob,
} from "./index.ts";

/**
 * @borrows Cron Jobs for leads
 *
 * @param {firstContactJob} - First contact job
 * @param {followUpJob} - Follow-up job
 * @param {researchJob} - Research job
 * @param {remindersJob} - Reminders job
 * @param {autoCloseJob} - Auto-close job
 * @param {followUpLimitJob} - Follow-up limit job
 * @param {templateSyncJob} - Template sync job
 *
 */
export function cronJobs() {
  // Every 5 mins — small tasks
  cron.schedule("*/5 * * * *", async () => {
    try {
      await firstContactJob();
      await followUpJob();
    } catch (err) {
      console.error("❌ 5-minute jobs failed:", err);
    }
  });

  // Every midnight — heavy tasks
  cron.schedule("0 0 * * *", async () => {
    try {
      await researchJob();
      await remindersJob();
      await autoCloseJob();
      await followUpLimitJob();
    } catch (err) {
      console.error("❌ Midnight jobs failed:", err);
    }
  });

  // Every day at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    try {
      await templateSyncJob();
    } catch (err) {
      console.error("❌ 2 AM templateSyncJob failed:", err);
    }

    try {
      const { crmQueue } = await import("./saas/crmWorker.ts");
      const mongoose = (await import("mongoose")).default;
      const db = mongoose.connection.useDb("saas_services", { useCache: true });
      const Tenant =
        db.models.Tenant ||
        db.model(
          "Tenant",
          new mongoose.Schema(
            { clientCode: String, status: String },
            { strict: false },
          ),
        );
      const tenants = await Tenant.find({ status: "active" });

      for (const tenant of tenants) {
        await crmQueue.add({
          clientCode: tenant.clientCode,
          type: "crm.score_refresh",
          payload: { batch: true },
        });
      }
      console.log(
        `[cron] Enqueued nightly score recalculation for ${tenants.length} tenants.`,
      );
    } catch (err) {
      console.error("❌ Nightly score recalculation failed:", err);
    }
  });
}
