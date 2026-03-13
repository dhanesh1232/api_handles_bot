import { dbConnect } from "@lib/config";
import { ClientUsage } from "@models/clients/usage.model";

/**
 * Usage Service
 * Manages the "Wealth" engine: credit allocation, consumption tracking, and exhaustion guards.
 */
export const UsageService = {
  /**
   * Deduct credits from a client's balance for a specific action.
   * Returns true if credits were sufficient and deducted, false if exhausted.
   */
  consume: async (clientCode: string, type: "whatsapp_msg" | "email_msg" | "ai_token" | "automation_run", amount: number = 1) => {
    try {
      await dbConnect("services");
      const month = new Date().toISOString().substring(0, 7); // "YYYY-MM"

      // Atomically find and increment usage
      const usage = await ClientUsage.findOneAndUpdate(
        { clientCode, type, month },
        { 
          $setOnInsert: { totalCredits: 1000 }, // Default if not set
          $inc: { usedCredits: amount } 
        },
        { upsert: true, returnDocument: "after" }
      ).lean();

      if (!usage) return false;

      // Logic check for exhaustion (allow slight burst/overage if needed, or strictly block)
      if (usage.usedCredits > usage.totalCredits) {
        if (usage.status !== "exhausted") {
          await ClientUsage.updateOne({ _id: usage._id }, { $set: { status: "exhausted" } });
        }
        return false; // Exhausted
      }

      // Warning threshold (80%)
      if (usage.status === "active" && usage.usedCredits / usage.totalCredits > 0.8) {
        await ClientUsage.updateOne({ _id: usage._id }, { $set: { status: "warning" } });
      }

      return true;
    } catch (err) {
      console.error(`❌ [UsageService] Failed to consume ${type} for ${clientCode}:`, err);
      return true; // Fail-open to avoid breaking production flows if usage tracking hits an issue
    }
  },

  /**
   * Top up credits for a client
   */
  addCredits: async (clientCode: string, type: string, amount: number) => {
    await dbConnect("services");
    const month = new Date().toISOString().substring(0, 7);
    return ClientUsage.findOneAndUpdate(
      { clientCode, type, month },
      { $inc: { totalCredits: amount }, $set: { status: "active" } },
      { upsert: true, returnDocument: "after" }
    ).lean();
  },

  /**
   * Get current usage stats for dashboarding
   */
  getUsage: async (clientCode: string) => {
    await dbConnect("services");
    const month = new Date().toISOString().substring(0, 7);
    return ClientUsage.find({ clientCode, month }).lean();
  }
};
