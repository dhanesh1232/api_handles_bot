/**
 * @host get.crm.model.ts
 *
 * Returns all 6 CRM Mongoose models bound to the client's tenant DB connection.
 * Every CRM service function should call this helper at the top:
 *
 * const { Lead, Pipeline, ... } = await getCrmModels(clientCode);
 *
 * All subsequent reads/writes will go to that client's own MongoDB, not the
 * central services DB.
 */

import mongoose, { type Model } from "mongoose";
import { AutomationRuleSchema } from "../../model/saas/crm/automationRule.model.ts";
import { LeadSchema } from "../../model/saas/crm/lead.model.ts";
import { LeadActivitySchema } from "../../model/saas/crm/leadActivity.model.ts";
import { LeadNoteSchema } from "../../model/saas/crm/leadNote.model.ts";
import { PipelineSchema } from "../../model/saas/crm/pipeline.model.ts";
import { PipelineStageSchema } from "../../model/saas/crm/pipelineStage.model.ts";
import { GetURI, tenantDBConnect } from "./connection.ts";

// ─── Model registry per connection ────────────────────────────────────────────
// Each tenant Connection caches its own compiled models.
// We reuse them on subsequent calls — no re-compilation overhead.

function getOrCreate<T>(
  conn: mongoose.Connection,
  name: string,
  schema: mongoose.Schema<T>,
): Model<T> {
  if (conn.models[name]) return conn.models[name] as Model<T>;
  return conn.model<T>(name, schema);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CrmModels {
  Lead: Model<ILead>;
  Pipeline: Model<IPipeline>;
  PipelineStage: Model<IPipelineStage>;
  LeadActivity: Model<ILeadActivity>;
  LeadNote: Model<ILeadNote>;
  AutomationRule: Model<IAutomationRule>;
}

/**
 * Returns all CRM models bound to the client's own DB connection.
 * The connection is cached — subsequent calls for the same clientCode are free.
 */
export async function getCrmModels(clientCode: string): Promise<CrmModels> {
  const uri = await GetURI(clientCode);
  const conn = await tenantDBConnect(uri);

  return {
    Lead: getOrCreate<ILead>(conn, "Lead", LeadSchema),
    Pipeline: getOrCreate<IPipeline>(conn, "Pipeline", PipelineSchema),
    PipelineStage: getOrCreate<IPipelineStage>(
      conn,
      "PipelineStage",
      PipelineStageSchema,
    ),
    LeadActivity: getOrCreate<ILeadActivity>(
      conn,
      "LeadActivity",
      LeadActivitySchema,
    ),
    LeadNote: getOrCreate<ILeadNote>(conn, "LeadNote", LeadNoteSchema),
    AutomationRule: getOrCreate<IAutomationRule>(
      conn,
      "AutomationRule",
      AutomationRuleSchema,
    ),
  };
}
