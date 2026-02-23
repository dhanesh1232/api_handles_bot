import { dbConnect } from "../../lib/config.ts";
import { Lead } from "../../model/services/leads.ts";

export async function firstContactJob() {
  await dbConnect("services");

  const now = new Date();
  console.log("Jobs running...", now);

  const leads = await Lead.find({
    firstContactDone: false,
    firstContactDue: { $lt: now },
    firstContactOverdue: false,
    status: { $in: ["researching", "qualified"] },
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { firstContactOverdue: true },
        $push: {
          activity: {
            type: "status-changed",
            message: "First contact overdue",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`First-contact check finished: ${leads.length} overdue`);
}
