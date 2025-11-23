// src/worker/jobs/remindersJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const remindersJob = async () => {
  await dbConnect("services");
  const now = new Date();

  const leads = await Lead.find({
    $or: [{ reminderDate: { $lt: now } }, { callBackDate: { $lt: now } }],
  });

  for (const lead of leads) {
    lead.activity.push({
      type: "status-changed",
      message: "Reminder/Callback time reached",
      createdAt: now,
    });

    // Reset reminder so it doesn't repeat
    lead.reminderDate = null;
    lead.callBackDate = null;

    await lead.save();
  }

  console.log(`Reminders executed: ${leads.length}`);
};
