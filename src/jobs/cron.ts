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
      console.error("❌ 2 AM jobs failed:", err);
    }
  });
}
