import * as dotenv from "dotenv";
import { getCrmModels } from "../src/lib/tenant/crm.models";

dotenv.config();

async function run() {
  const clientCode = "ERIX_CLNT1";
  const { AutomationRule } = await getCrmModels(clientCode);
  const rule = await AutomationRule.findById("69b68fa23b3654fe9b6f5f16").lean();
  console.log("Rule Details:", JSON.stringify(rule, null, 2));
  process.exit(0);
}
run();
