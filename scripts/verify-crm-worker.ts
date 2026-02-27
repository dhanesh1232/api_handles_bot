import "dotenv/config";
import { dbConnect } from "../src/lib/config.ts";
import { MongoQueue } from "../src/lib/mongoQueue/index.ts";
import Job from "../src/model/queue/job.model.ts";

const clientCode = "ERIX_CLNT1";
const queue = MongoQueue.getQueue("crm");

async function run() {
  await dbConnect("services");
  console.log("✅ Connected to MongoDB");

  // We need a real lead ID to test crm.score_refresh safely
  const { getCrmModels } = await import("../src/lib/tenant/get.crm.model.ts");
  const { Lead } = await getCrmModels(clientCode);
  const lead = await Lead.findOne({ clientCode });

  if (!lead) {
    console.error(
      "❌ No lead found for client ERIX_CLNT1. Create one first using test.bash.",
    );
    process.exit(1);
  }

  console.log(`📋 Enqueueing score_refresh job for lead ${lead._id}...`);
  const job = await queue.add({
    clientCode,
    type: "crm.score_refresh",
    payload: { leadId: lead._id.toString() },
  });

  console.log(`✅ Job enqueued: ${job._id}. Waiting for worker...`);

  const start = Date.now();
  while (Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 2000));
    const latest = await Job.findById(job._id);
    if (!latest) break;

    console.log(
      `[${Math.floor((Date.now() - start) / 1000)}s] status=${latest.status}`,
    );
    if (latest.status === "completed") {
      console.log("🎉 Worker picked up and completed the job!");
      process.exit(0);
    }
    if (latest.status === "failed") {
      console.error(`❌ Job failed: ${latest.lastError}`);
      process.exit(1);
    }
  }

  console.error("❌ Timeout: Worker did not pick up the job within 30s.");
  process.exit(1);
}

run().catch(console.error);
