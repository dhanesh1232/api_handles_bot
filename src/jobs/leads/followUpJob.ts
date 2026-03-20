import { dbConnect } from "@/lib/config";
import { Lead } from "@/model/services/leads";

/**
 * The "Reliability Guard" for the sales team. Ensures that no scheduled follow-up is missed by escalating overdue tasks.
 *
 * **DETAILED EXECUTION:**
 * 1. **Deadline Detection**: Identifies active leads where the `nextFollowUpDate` has passed.
 * 2. **State Escalation**:
 *    - Flips the `followUpOverdue` boolean to `true` (triggering red UI highlights for agents).
 *    - Pushes a "Follow-up overdue" alert to the lead's activity timeline.
 *
 * **GOAL**: Prevent lead leakage by forcing visibility on missed deadlines.
 */
export const followUpJob = async () => {
  await dbConnect("services");
  const now = new Date();

  const leads = await Lead.find({
    nextFollowUpDate: { $lt: now },
    followUpOverdue: false,
    status: { $in: ["contacted", "responded", "follow-up"] },
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { followUpOverdue: true },
        $push: {
          activity: {
            type: "follow-up",
            message: "Follow-up overdue",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Follow-up overdue updated: ${leads.length}`);
};
