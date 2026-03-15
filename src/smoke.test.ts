import "dotenv/config";
import assert from "node:assert";
import { after, describe, test } from "node:test";
import mongoose from "mongoose";
import { dbConnect } from "./lib/config.ts";
import { tenantModelConfig } from "./lib/tenant/crm.models.ts"; // Note: .js for node execution
import { ClientDataSource } from "./model/clients/dataSource.ts";

describe("Backend System Validation (Smoke Tests)", () => {
  after(async () => {
    // Ensure we close the connection so the test process exits cleanly
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  test("1. Environment Variables Check", () => {
    const requiredEnvVars = [
      "PORT",
      "MONGODB_URI",
      "MONGODB_URI_END",
      "CORE_API_KEY",
      "ENCRYPTION_KEY",
    ];

    for (const envVar of requiredEnvVars) {
      assert.ok(
        process.env[envVar],
        `Environment variable ${envVar} must be defined in .env`,
      );
    }
  });

  test("2. Schema Integrity Check", () => {
    assert.ok(
      tenantModelConfig.Conversation.schema,
      "Conversation schema should be defined",
    );
    assert.ok(
      tenantModelConfig.Message.schema,
      "Message schema should be defined",
    );
    assert.ok(tenantModelConfig.Lead.schema, "Lead schema should be defined");
    assert.ok(
      tenantModelConfig.Pipeline.schema,
      "Pipeline schema should be defined",
    );
    assert.ok(
      tenantModelConfig.PipelineStage.schema,
      "Pipeline Stage schema should be defined",
    );
    assert.ok(
      tenantModelConfig.AutomationRule.schema,
      "Automation Rule schema should be defined",
    );
    assert.ok(
      tenantModelConfig.LeadActivity.schema,
      "Lead Activity schema should be defined",
    );
    assert.ok(
      tenantModelConfig.LeadNote.schema,
      "Lead Note schema should be defined",
    );

    // Ensure they are actually mongoose schemas
    assert.strictEqual(
      tenantModelConfig.Lead.schema.constructor.name,
      "Schema",
      "Leads should be a valid Mongoose Schema instance",
    );
  });

  test("3. Database Connection & Query Validation", async () => {
    // Ensure we have the URI before attempting to connect
    if (!process.env.MONGODB_URI) {
      assert.fail("MONGODB_URI is missing, skipping DB test.");
      return;
    }

    try {
      // Connect to the 'services' database
      const conn = await dbConnect("services");

      // Verify connection state is connected
      assert.strictEqual(
        conn.connection.readyState,
        1,
        "Mongoose should be in a connected state (1)",
      );

      // Perform a basic query to ensure the database is fully responsive.
      // Even if the collection is empty, the query should not throw an error.
      const count = await ClientDataSource.countDocuments();
      assert.ok(
        count >= 0,
        "Should successfully execute a count query on the services database",
      );
    } catch (err: any) {
      assert.fail(`Database validation failed: ${err.message}`);
    }
  });
});
