import { dbConnect } from "../../lib/config.ts";
import { Lead } from "../../model/services/leads.ts";

export const autoCloseJob = async () => {
  await dbConnect("services");

  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({
    updatedAt: { $lt: days30 },
    status: { $nin: ["closed-won", "closed-lost"] },
  });

  if (leads.length > 0) {
    await Lead.updateMany(
      { _id: { $in: leads.map((l) => l._id) } },
      {
        $set: { status: "no-response" },
        $push: {
          activity: {
            type: "status-changed",
            message: "Auto-closed due to inactivity (30 days)",
            createdAt: now,
          },
        },
      },
    );
  }

  console.log(`Auto-closed leads: ${leads.length}`);
};
