import { dbConnect } from "../src/lib/config.ts";
import { getCrmModels } from "../src/lib/tenant/get.crm.model.ts";

async function main() {
  await dbConnect("services");
  const { Pipeline, PipelineStage } = await getCrmModels("ERIX_CLNT1");
  const pipelines = await Pipeline.find({});
  const stages = await PipelineStage.find({});

  console.log(JSON.stringify({ pipelines, stages }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
