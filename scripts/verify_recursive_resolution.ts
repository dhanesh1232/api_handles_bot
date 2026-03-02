import mongoose from "mongoose";
import { dbConnect } from "../src/lib/config.ts";
import { getTenantConnection } from "../src/lib/connectionManager.ts";
import { ClientDataSource } from "../src/model/clients/dataSource.ts";
import { schemas } from "../src/model/saas/tenant.schemas.ts";
import { resolveUnifiedWhatsAppTemplate } from "../src/services/saas/whatsapp/template.service.ts";

async function run() {
  await dbConnect("services");
  const clientCode = "ERIX_CLNT1";

  const ds = await ClientDataSource.findOne({ clientCode });
  if (!ds) throw new Error("Client not found");

  const tenantConn = await getTenantConnection(clientCode);
  const Template = tenantConn.model("Template", schemas.templates);

  // 1. Setup a test template with recursive mapping
  const templateName = "test_recursive_v1";
  await Template.findOneAndUpdate(
    { name: templateName },
    {
      name: templateName,
      language: "en_US",
      variablesCount: 2,
      variablePositions: [1, 2],
      variableMapping: [
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
          label: "Doctor Specialization",
          source: "crm",
          collection: "doctors",
          field: "specialization",
          required: true,
          componentType: "BODY",
          originalIndex: 2,
        },
      ],
      mappingStatus: "complete",
      status: "APPROVED",
      isActive: true,
    },
    { upsert: true },
  );

  // 2. Setup mock data
  const leadId = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const appointmentId = new mongoose.Types.ObjectId();

  const Appointment = tenantConn.collection("appointments");
  const Doctor = tenantConn.collection("doctors");

  await Doctor.updateOne(
    { _id: doctorId },
    {
      $set: {
        name: "Dr. Test",
        specialization: "Cardiology",
        slug: `test-doctor-${Date.now()}`,
      },
    },
    { upsert: true },
  );

  await Appointment.updateOne(
    { _id: appointmentId },
    { $set: { patientName: "John Doe", doctorId: doctorId, leadId: leadId } },
    { upsert: true },
  );

  const mockLead = {
    _id: leadId,
    name: "John Doe",
    metadata: {
      refs: {
        appointmentId: appointmentId.toString(),
      },
    },
  };

  console.log("--- Testing Recursive Resolution ---");
  const result = await resolveUnifiedWhatsAppTemplate(
    tenantConn,
    templateName,
    mockLead,
    {},
  );

  console.log("Resolved Variables:", result.resolvedVariables);
  console.log("Language Code:", result.languageCode);
  console.log(
    "Context Collections Found:",
    Object.keys(result.contextSnapshot).filter((k) =>
      ["appointments", "doctors"].includes(k),
    ),
  );

  if (
    result.resolvedVariables[0] === "John Doe" &&
    result.resolvedVariables[1] === "Cardiology"
  ) {
    console.log("✅ RECURSIVE RESOLUTION SUCCESS");
  } else {
    console.error("❌ RECURSIVE RESOLUTION FAILED");
  }

  await mongoose.disconnect();
}

run().catch(console.error);
