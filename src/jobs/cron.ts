import cron from "node-cron";
import { jobLogger } from "@/lib/logger";
import {
  autoCloseJob,
  firstContactJob,
  followUpJob,
  followUpLimitJob,
  remindersJob,
  researchJob,
  templateSyncJob,
} from "./index.ts";

export function cronJobs() {
  // Every 5 mins — small tasks
  cron.schedule("*/5 * * * *", async () => {
    const log = jobLogger("cron:5min");
    try {
      await firstContactJob();
      await followUpJob();
    } catch (err) {
      log.error({ err }, "5-minute cron jobs failed");
    }
  });

  // Every midnight — heavy tasks
  cron.schedule("0 0 * * *", async () => {
    const log = jobLogger("cron:midnight");
    try {
      await researchJob();
      await remindersJob();
      await autoCloseJob();
      await followUpLimitJob();
    } catch (err) {
      log.error({ err }, "Midnight cron jobs failed");
    }
  });

  // Every day at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    const log = jobLogger("cron:2am");

    try {
      await templateSyncJob();
    } catch (err) {
      log.error({ err }, "templateSyncJob failed");
    }

    try {
      const { crmQueue } = await import("./saas/crmWorker.ts");
      const { dbConnect } = await import("@/lib/config");
      const { Client } = await import("@/model/clients/client");

      await dbConnect("services");
      const clients = await Client.find({ status: "active" }).lean();

      for (const client of clients) {
        await crmQueue.add({
          clientCode: client.clientCode,
          type: "crm.score_refresh",
          payload: { batch: true },
        });
      }

      log.info(
        { tenantCount: clients.length },
        "Enqueued nightly score recalculation",
      );
    } catch (err) {
      log.error({ err }, "Nightly score recalculation failed");
    }
  });
}
