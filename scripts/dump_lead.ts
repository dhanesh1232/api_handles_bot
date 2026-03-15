/**
 * Finds a lead by ID (from the failed job) and prints phone + name.
 * Lead ID from the failed job: 69b05c34b9b91bde1ba6eab1
 * Run from: /home/dhanesh/ecodrix/ECOD/backend
 *   pnpm tsx scripts/dump_lead.ts
 */

import mongoose from "mongoose";
import { getCrmModels } from "../src/lib/tenant/crm.models";

const CLIENT_CODE = "ERIX_CLNT1";
// The lead ID from the automation failure logs
const LEAD_ID = "69b05c34b9b91bde1ba6eab1";

async function run() {
  const { Lead } = await getCrmModels(CLIENT_CODE);
  const lead = await Lead.findById(new mongoose.Types.ObjectId(LEAD_ID)).lean();
  if (lead) {
    console.log("Phone:", lead.phone);
    console.log("Name:", lead.firstName, lead.lastName);
    console.log(
      "Full lead:",
      JSON.stringify(
        {
          _id: lead._id,
          phone: lead.phone,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("Lead NOT found with ID:", LEAD_ID);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
