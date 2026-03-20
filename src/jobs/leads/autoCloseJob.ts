import { dbConnect } from "@/lib/config";
import { Lead } from "@/model/services/leads";

/**
 * The "Sanitation Worker" of the CRM. Automatically prunes dead leads to ensure sales teams focus on active opportunities.
 *
 * **DETAILED EXECUTION:**
 * 1. **Temporal Filtering**: Scans the global `Lead` collection for records where `updatedAt` is older than 30 days.
 * 2. **Terminal State Guard**: Excludes leads already marked as `closed-won` or `closed-lost` to avoid interfering with historical data.
 * 3. **Mass Transition**:
 *    - Updates `status` to `no-response`.
 *    - Injects a system activity record explaining the auto-closure.
 *
 * **GOAL**: Maintain a high-quality, high-velocity pipeline by removing "ghost" leads.
 */
export const autoCloseJob = async () => {
  await dbConnect("services");

  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({
    updatedAt: { $lt: days30 },
    status: { $nin: ["closed-won", "closed-lost"] },
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { status: "no-response" },
        $push: {
          activity: {
            type: "status-changed",
            message: "Auto-closed due to inactivity (30 days)",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Auto-closed leads: ${leads.length}`);
};
