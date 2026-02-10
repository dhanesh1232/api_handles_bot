// src/worker/jobs/remindersJob.js
import { dbConnect } from "../../lib/config.js";
import { Lead } from "../../model/services/leads.js";

export const remindersJob = async () => {
  await dbConnect("services");
  const now = new Date();

  const leads = await Lead.find({
    $or: [{ reminderDate: { $lt: now } }, { callBackDate: { $lt: now } }],
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { reminderDate: null, callBackDate: null },
        $push: {
          activity: {
            type: "status-changed",
            message: "Reminder/Callback time reached",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Reminders executed: ${leads.length}`);
};
