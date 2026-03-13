import mongoose from "mongoose";
import { getCrmModels } from "../src/lib/tenant/get.crm.model";
import * as dotenv from "dotenv";
import { dbConnect } from "../src/lib/config";
dotenv.config();

async function checkPipelines() {
  const clientCode = "ERIX_CLNT1";
  console.log(`Checking pipelines for ${clientCode}...`);

  dbConnect("services");

  const { Pipeline } = await getCrmModels(clientCode);
  const pipelines = await Pipeline.find({ clientCode, isActive: true });

  console.log("Pipelines found:");
  pipelines.forEach((p) => {
    console.log(`- ${p.name} (ID: ${p._id}) (Default: ${p.isDefault})`);
  });
}

checkPipelines().catch(console.error);
