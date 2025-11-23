// src/worker/jobs/autoCloseJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const autoCloseJob = async () => {
  await dbConnect("services");

  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({
    updatedAt: { $lt: days30 },
    status: { $nin: ["closed-won", "closed-lost"] },
  });

  for (const lead of leads) {
    lead.status = "no-response";

    lead.activity.push({
      type: "status-changed",
      message: "Auto-closed due to inactivity (30 days)",
      createdAt: now,
    });

    await lead.save();
  }

  console.log(`Auto-closed leads: ${leads.length}`);
};
