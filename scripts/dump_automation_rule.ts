/**
 * Inspect the "Report Welcome message" automation rule + the toxin_report_gen_v1 template mapping.
 * Uses getCrmModels for proper tenant isolation (no external DB connections).
 * Run from: /home/dhanesh/ecodrix/ECOD/backend
 *   pnpm tsx scripts/dump_automation_rule.ts
 */
import { getCrmModels } from "../src/lib/tenant/crm.models";

const CLIENT_CODE = "ERIX_CLNT1";

async function run() {
  const { AutomationRule, Template } = await getCrmModels(CLIENT_CODE);

  const rule = await AutomationRule.findOne({ name: "Report Welcome message" }).lean();
  if (rule) {
    console.log("\n=== AUTOMATION RULE ===");
    console.log("Trigger:", rule.trigger);
    console.log("Actions:", JSON.stringify(rule.actions, null, 2));
    console.log("Conditions:", JSON.stringify(rule.conditions, null, 2));
  } else {
    console.log("Rule NOT found");
  }

  const tmpl = await Template.findOne({ name: "toxin_report_gen_v1" }).lean();
  if (tmpl) {
    console.log("\n=== TEMPLATE variableMapping ===");
    console.log(JSON.stringify(tmpl.variableMapping, null, 2));
  }

  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
