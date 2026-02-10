// src/worker/jobs/followUpLimitJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const followUpLimitJob = async () => {
  await dbConnect("services");

  const leads = await Lead.find({
    followUpCount: { $gte: 6 },
    status: { $ne: "closed-lost" },
  });

  if (leads.length > 0) {
    const now = new Date();
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { status: "no-response" },
        $push: {
          activity: {
            type: "follow-up",
            message: "Max follow-up limit reached (auto no-response)",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Follow-up limit enforced: ${leads.length}`);
};
