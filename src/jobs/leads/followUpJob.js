// src/worker/jobs/followUpJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const followUpJob = async () => {
  await dbConnect("services");
  const now = new Date();

  const leads = await Lead.find({
    nextFollowUpDate: { $lt: now },
    followUpOverdue: false,
    status: { $in: ["contacted", "responded", "follow-up"] },
  });

  for (const lead of leads) {
    lead.followUpOverdue = true;

    lead.activity.push({
      type: "follow-up",
      message: "Follow-up overdue",
      createdAt: now,
    });

    await lead.save();
  }

  console.log(`Follow-up overdue updated: ${leads.length}`);
};
