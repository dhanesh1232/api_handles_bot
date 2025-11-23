// src/worker/jobs/followUpLimitJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const followUpLimitJob = async () => {
  await dbConnect("services");

  const leads = await Lead.find({
    followUpCount: { $gte: 6 },
    status: { $ne: "closed-lost" },
  });

  for (const lead of leads) {
    lead.status = "no-response";

    lead.activity.push({
      type: "follow-up",
      message: "Max follow-up limit reached (auto no-response)",
      createdAt: new Date(),
    });

    await lead.save();
  }

  console.log(`Follow-up limit enforced: ${leads.length}`);
};
