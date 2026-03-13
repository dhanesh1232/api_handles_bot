import { dbConnect } from "../src/lib/config.ts";
import { getCrmModels } from "../src/lib/tenant/get.crm.model.ts";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend root
dotenv.config({ path: join(__dirname, "../.env") });

async function checkPipelines() {
  const clientCode = "ERIX_CLNT1";
  console.log(`Checking pipelines for ${clientCode}...`);

  try {
    // Connect to the services DB first so we can find the tenant mapping
    await dbConnect("services");
    console.log("Connected to services DB.");

    const { Pipeline } = await getCrmModels(clientCode);
    const pipelines = await Pipeline.find({ isActive: true });

    console.log("Pipelines found:");
    if (pipelines.length === 0) {
      console.log("No active pipelines found for this client.");
    }
    pipelines.forEach((p) => {
      console.log(`- ${p.name} (ID: ${p._id}) (Default: ${p.isDefault})`);
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

checkPipelines().catch(console.error);
