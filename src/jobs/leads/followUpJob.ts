import { dbConnect } from "../../lib/config.ts";
import { Lead } from "../../model/services/leads.ts";

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
