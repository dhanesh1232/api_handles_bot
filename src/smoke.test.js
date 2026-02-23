import "dotenv/config";
import assert from "node:assert";
import { test } from "node:test";
import { schemas } from "./model/saas/tenantSchemas.js";

test("Schema Integrity Check", () => {
  assert.ok(schemas.conversations, "Conversation schema should be defined");
  assert.ok(schemas.messages, "Message schema should be defined");
  assert.ok(schemas.leads, "Leads schema should be defined");
  assert.ok(schemas.pipelines, "Pipelines schema should be defined");
  assert.ok(schemas.pipelineStages, "Pipeline Stages schema should be defined");
  assert.ok(
    schemas.automationRules,
    "Automation Rules schema should be defined",
  );
  assert.ok(schemas.leadActivities, "Lead Activities schema should be defined");
  assert.ok(schemas.leadNotes, "Lead Notes schema should be defined");
});

test("Environment Variable Check", () => {
  // Check for critical variables that should exist in a standard environment
  // We don't check for ALL, just to ensure dotenv is working
  assert.ok(
    process.env.PORT,
    "PORT should be defined (defaults to 4000 usually)",
  );
});
