import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert";
import { schemas } from "./model/saas/tenantSchemas.js";

test("Schema Integrity Check", () => {
  assert.ok(schemas.conversations, "Conversation schema should be defined");
  assert.ok(schemas.messages, "Message schema should be defined");
  assert.ok(schemas.leads, "Leads schema should be defined");
});

test("Environment Variable Check", () => {
  // Check for critical variables that should exist in a standard environment
  // We don't check for ALL, just to ensure dotenv is working
  assert.ok(
    process.env.PORT,
    "PORT should be defined (defaults to 4000 usually)",
  );
});
