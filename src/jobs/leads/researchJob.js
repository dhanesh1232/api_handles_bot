// src/worker/jobs/researchJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const researchJob = async () => {
  await dbConnect("services");

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({
    "research.status": true,
    "research.notes": null,
    createdAt: { $lt: twoDaysAgo },
    status: "researching",
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $push: {
          activity: {
            type: "status-changed",
            message: "Research taking too long (no notes added)",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Research delay flagged: ${leads.length}`);
};
