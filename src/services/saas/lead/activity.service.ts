import mongoose from "mongoose";
import LeadActivity from "../../../model/saas/crm/leadActivity.model.ts";

/**
 * Log activity for a Lead
 * @param {string} clientCode
 * @param {string} leadId
 * @param {string} type
 * @param {string} description
 * @param {Object} metadata
 */
export async function logActivity(
  clientCode: string,
  leadId: string | mongoose.Types.ObjectId,
  type: string,
  description: string,
  metadata: any = {},
): Promise<void> {
  try {
    await LeadActivity.create({
      clientCode,
      leadId,
      type,
      description,
      metadata,
    });
  } catch (err) {
    console.error("❌ Failed to log Lead activity:", err);
  }
}

