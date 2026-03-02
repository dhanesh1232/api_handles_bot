import mongoose from "mongoose";
import { dbConnect } from "../src/lib/config.ts";
import { ClientDataSource } from "../src/model/clients/dataSource.ts";
import { schemas } from "../src/model/saas/tenant.schemas.ts";

async function check() {
  await dbConnect("services");
  const clientCode = "ERIX_CLNT1";
  const datasource = await ClientDataSource.findOne({ clientCode });
  if (!datasource) throw new Error("Datasource not found");
  const tenantUri = datasource.getUri();
  const tenantConn = mongoose.createConnection(tenantUri!);
  await tenantConn.asPromise();

  const Template = tenantConn.model("Template", schemas.templates);
  const tmpl = await Template.findOne({ name: "doctor_appointment_final_v1" });

  if (tmpl) {
    console.log(
      "Template mapping:",
      JSON.stringify(tmpl.variableMapping, null, 2),
    );
  } else {
    console.log("Template not found");
  }

  await tenantConn.close();
  await mongoose.disconnect();
}

check().catch(console.error);
