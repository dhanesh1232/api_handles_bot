import mongoose from "mongoose";
import { dbConnect } from "../src/lib/config.ts";
import { ClientDataSource } from "../src/model/clients/dataSource.ts";
import { schemas } from "../src/model/saas/tenant.schemas.ts";
import {
  buildDynamicTemplateContext,
  resolveTemplateVariables,
} from "../src/services/saas/whatsapp/template.service.ts";

async function verify() {
  await dbConnect("services");
  const clientCode = "ERIX_CLNT1";
  const datasource = await ClientDataSource.findOne({ clientCode });
  const tenantUri = datasource.getUri();
  const tenantConn = mongoose.createConnection(tenantUri!);
  await tenantConn.asPromise();

  // 1. Create a dummy template that uses 'orders' collection
  const Template = tenantConn.model("Template", schemas.templates);
  const testTmplName = "test_generic_resolution_orders";

  await Template.findOneAndUpdate(
    { name: testTmplName },
    {
      name: testTmplName,
      category: "UTILITY",
      components: [{ type: "BODY", text: "Order Total: {{1}}" }],
      variableMapping: [
        {
          position: 1,
          label: "Order Price",
          source: "crm",
          collection: "orders",
          field: "totalPrice",
          required: true,
          componentType: "BODY",
          originalIndex: 1,
        },
      ],
    },
    { upsert: true, new: true },
  );

  console.log("✅ Mock template created");

  // 2. Mock lead and event variables
  const Lead = tenantConn.model("Lead", schemas.leads);
  const lead = await Lead.findOne({
    _id: new mongoose.Types.ObjectId("6995cd04705a1366bc31b925"),
  });

  const eventVars = {
    orderId: "6995f9879f7b867955ce913f", // The order we found
  };

  console.log("🔄 Resolving context for collection: orders...");

  const context = await buildDynamicTemplateContext(
    tenantConn,
    testTmplName,
    lead,
    eventVars,
  );

  console.log("Context Keys found:", Object.keys(context));

  if (context.orders) {
    console.log(
      "✅ Found order in context! Total Price:",
      context.orders.totalPrice,
    );

    const resolved = await resolveTemplateVariables(
      tenantConn,
      testTmplName,
      context,
    );
    console.log("Resolved Variables:", resolved);

    if (resolved[0] === "799") {
      console.log(
        '🚀 SUCCESS: The system successfully fetched from "orders" using "orderId"!',
      );
    } else {
      console.log("❌ FAILURE: Resolved value mismatch");
    }
  } else {
    console.log("❌ FAILURE: Order not found in context");
  }

  await tenantConn.close();
  await mongoose.disconnect();
}

verify().catch(console.error);
