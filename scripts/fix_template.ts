import mongoose from "mongoose";
import { dbConnect } from "../src/lib/config.ts";
import { ClientDataSource } from "../src/model/clients/dataSource.ts";
import { schemas } from "../src/model/saas/tenant.schemas.ts";

async function fix() {
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
    console.log("Updating template mapping...");
    tmpl.variableMapping = [
      {
        position: 1,
        label: "Patient Name",
        source: "crm",
        collection: "appointments",
        field: "patientName",
        required: true,
        componentType: "BODY",
        originalIndex: 1,
      },
      {
        position: 2,
        label: "Doctor Name",
        source: "crm",
        collection: "doctors",
        field: "name",
        required: true,
        componentType: "BODY",
        originalIndex: 2,
      },
      {
        position: 3,
        label: "Appointment Date & Time",
        source: "computed",
        formula: "concat(vars.date, ' at ', vars.time)",
        required: true,
        componentType: "BODY",
        originalIndex: 3,
      },
      {
        position: 4,
        label: "Meet Code (Button)",
        source: "computed",
        formula: "vars.meet_code",
        required: true,
        componentType: "BUTTON",
        componentIndex: 0,
        originalIndex: 1,
      },
    ];

    const bodyComp = tmpl.components.find((c: any) => c.type === "BODY");
    if (bodyComp) {
      bodyComp.text =
        "Namaste {{1}}! Your appointment with {{2}} is confirmed for {{3}}. Click below to join your consultation.";
    }

    tmpl.markModified("variableMapping");
    tmpl.markModified("components");
    await tmpl.save();
    console.log("Template mapping updated successfully");
  } else {
    console.log("Template doctor_appointment_final_v1 not found");
  }

  await tenantConn.close();
  await mongoose.disconnect();
}

fix().catch(console.error);
