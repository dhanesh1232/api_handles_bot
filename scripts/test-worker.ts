import "dotenv/config";

/**
 * test-worker.ts — CLI script to enqueue a WhatsApp workflow job
 * and watch the MongoWorker pick it up.
 *
 * Usage:
 *   pnpm tsx scripts/test-worker.ts \
 *     --clientCode NIRVISHAM \
 *     --phone 919876543210 \
 *     --template appointment_confirmed \
 *     --delay 0
 *
 * The script inserts a job into the services DB.
 * If the backend server is running, its worker will pick it up within 10s.
 * If not, this script starts a temporary in-process worker to execute it.
 */



import { parseArgs } from "node:util";
import { dbConnect } from "../src/lib/config.js";
import { MongoQueue } from "../src/lib/mongoQueue/index.js";
import Job from "../src/model/queue/job.model.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    clientCode: { type: "string", short: "c" },
    phone:       { type: "string", short: "p" },
    template:    { type: "string", short: "t" },
    delay:       { type: "string", short: "d", default: "0" },
    variables:   { type: "string", short: "v", default: "" },
    watch:       { type: "boolean", short: "w", default: false },
  },
  strict: false,
});

const clientCode = values.clientCode;
const phone      = values.phone;
const template   = values.template;
const delayMs    = parseInt(String(values.delay), 10) * 1000;
const variables  = values.variables ? String(values.variables).split(",") : [];
const watch      = values.watch;

if (!clientCode || !phone || !template) {
  console.error(`
Usage:
  pnpm tsx scripts/test-worker.ts \\
    --clientCode <code> \\
    --phone <e164_phone> \\
    --template <templateName> \\
    [--delay <seconds>] \\
    [--variables "var1,var2"] \\
    [--watch]

Example:
  pnpm tsx scripts/test-worker.ts \\
    --clientCode NIRVISHAM \\
    --phone 919876543210 \\
    --template appointment_confirmed \\
    --variables "Dhanesh,Dr. Arjun,Monday 10AM,abc-xyz"
`);
  process.exit(1);
}

const queue = MongoQueue.getQueue("whatsapp-workflow");

async function run() {
  await dbConnect("services");

  console.log("\n📋 Enqueueing job...");
  const job = await queue.add(
    {
      clientCode,
      phone,
      templateName: template,
      variables,
      channel: "whatsapp",
    },
    { delayMs }
  );

  console.log(`✅ Job enqueued:
  ID       : ${job._id}
  Queue    : whatsapp-workflow
  Client   : ${clientCode}
  Phone    : ${phone}
  Template : ${template}
  Variables: [${variables.join(", ")}]
  RunAt    : ${new Date(Date.now() + delayMs).toISOString()}
  `);

  if (!watch) {
    console.log(
      "ℹ  The running backend worker will pick this up within 10s.\n" +
      "   Run with --watch to poll status in this terminal.\n"
    );
    process.exit(0);
  }

  // --watch mode: poll the job status every 3s until done
  console.log("👀 Watching job status (Ctrl+C to stop)...\n");
  const MAX_WAIT_MS = 120_000;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    const latest = await Job.findById(job._id).lean();
    if (!latest) { console.log("Job not found"); break; }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] status=${latest.status}  attempts=${latest.attempts}${latest.lastError ? `  error=${latest.lastError}` : ""}`);

    if (latest.status === "completed") {
      console.log("\n🎉 Job completed — WhatsApp message sent!");
      break;
    }
    if (latest.status === "failed") {
      console.error(`\n❌ Job permanently failed: ${latest.lastError}`);
      break;
    }
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
