import mongoose from "mongoose";
import { dbConnect } from "../src/lib/config.ts";
import { ClientDataSource } from "../src/model/clients/dataSource.ts";
import { schemas } from "../src/model/saas/tenant.schemas.ts";

async function inspect() {
  await dbConnect("services");

  const clientCode = "ERIX_CLNT1";
  const datasource = await ClientDataSource.findOne({ clientCode });

  if (!datasource) {
    console.log(`Datasource for ${clientCode} not found in services DB`);
    process.exit(1);
  }

  const tenantUri = datasource.getUri();
  console.log(`Found tenant URI for ${clientCode}`);

  // Connect to tenant DB
  const tenantConn = mongoose.createConnection(tenantUri!);
  await tenantConn.asPromise();

  const Template = tenantConn.model("Template", schemas.templates);

  const tmpl = await Template.findOne({ name: "doctor_appointment_final_v1" });

  if (!tmpl) {
    console.log("Template not found in tenant DB");
  } else {
    console.log("Template info found");
    console.log("Mapping Status:", tmpl.mappingStatus);
    console.log(
      "Variable Mapping:",
      JSON.stringify(tmpl.variableMapping, null, 2),
    );
    console.log("Components:", JSON.stringify(tmpl.components, null, 2));
  }

  await tenantConn.close();
  await mongoose.disconnect();
}

inspect().catch(console.error);
