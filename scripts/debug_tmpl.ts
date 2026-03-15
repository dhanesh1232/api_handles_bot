
import { getCrmModels } from '../src/lib/tenant/crm.models';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const clientCode = "ERIX_CLNT1";
  const { Template } = await getCrmModels(clientCode);
  
  const tmpl = await Template.findOne({ name: "toxin_report_gen_v1" });
  if (!tmpl) {
    console.error("Template not found");
    process.exit(1);
  }

  // Update mapping to use camelCase (pdfUrl) to test fallback logic
  // and ensure body variable 1 is mapped to "name"
  const newMapping = [
    {
      position: 1,
      label: "DOCUMENT Header URL",
      componentType: "HEADER",
      originalIndex: 0,
      source: "trigger",
      field: "pdfUrl",
      required: false
    },
    {
      position: 2,
      label: "Body Variable 1",
      componentType: "BODY",
      originalIndex: 1,
      source: "trigger",
      field: "name",
      required: false
    }
  ];

  await Template.updateOne(
    { name: "toxin_report_gen_v1" },
    { 
      $set: { 
        variableMapping: newMapping,
        mappingStatus: "complete"
      } 
    }
  );

  console.log("Template Mapping Updated successfully using getCrmModels");
  const updated = await Template.findOne({ name: "toxin_report_gen_v1" }).lean();
  console.log("New Mapping:", JSON.stringify(updated?.variableMapping, null, 2));
  
  process.exit(0);
}
run();
