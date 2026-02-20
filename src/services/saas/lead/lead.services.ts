import mongoose from "mongoose";
import Lead from "../../../model/saas/crm/lead.model.ts";
import PipelineStage from "../../../model/saas/crm/pipelineStage.model.ts";
import { logActivity } from "./activity.service.ts";

/**
 * Upsert a Lead for a specific client
 * @param {string} clientCode
 * @param {Object} leadData
 * @param {Object} moduleInfo { type: 'order'|'enrollment'|'consultation', id: string }
 */
export async function upsertLead(
  clientCode: string,
  leadData: { phone: string; name?: string; email?: string; source?: string },
  moduleInfo: any = {},
): Promise<any> {
  const { phone, name, email, source = "manual" } = leadData;

  if (!phone) throw new Error("Phone number is required for Lead");

  let lead = await Lead.findOne({ clientCode, phone });

  if (lead) {
    // Update existing lead
    if (name) lead.name = name;
    if (email) lead.email = email;
    lead.source = source;
    lead.lastActivityAt = new Date();
    await lead.save();

    await logActivity(
      clientCode,
      lead._id as mongoose.Types.ObjectId,
      "info",
      `Lead updated from ${source}`,
      { moduleInfo },
    );
  } else {
    // Create new lead
    // Find default stage for "New" leads
    const defaultStage = await PipelineStage.findOne({
      clientCode,
      isDefault: true,
    });

    lead = await Lead.create({
      clientCode,
      phone,
      name,
      email,
      source,
      stageId: defaultStage?._id,
      pipelineId: defaultStage?.pipelineId,
      lastActivityAt: new Date(),
    });

    await logActivity(
      clientCode,
      lead._id as mongoose.Types.ObjectId,
      "info",
      `New lead created from ${source}`,
      { moduleInfo },
    );
  }

  return lead;
}

/**
 * Update Lead Stage
 */
export async function updateLeadStage(
  clientCode: string,
  leadId: string | mongoose.Types.ObjectId,
  stageId: string | mongoose.Types.ObjectId,
): Promise<any> {
  const stage = await PipelineStage.findById(stageId);
  if (!stage) throw new Error("Stage not found");

  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, clientCode },
    { stageId: stage._id, pipelineId: stage.pipelineId },
    { new: true },
  );

  if (lead) {
    await logActivity(
      clientCode,
      lead._id as mongoose.Types.ObjectId,
      "info",
      `Lead moved to stage: ${stage.name}`,
      { stageId },
    );
  }

  return lead;
}
