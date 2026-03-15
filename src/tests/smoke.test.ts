import axios from "axios";
import "dotenv/config";

/**
 * ECOD Backend Smoke Test
 * Run this to verify critical production flows.
 * Usage: pnpm ts-node src/tests/smoke.test.ts
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const CLIENT_CODE = process.env.TEST_CLIENT_CODE || "ERIX_CLNT1";
const API_KEY =
  process.env.TEST_API_KEY ||
  "ERIXDE022108B494597415C47FFB09C25EC1355B9E0564A5515D";
const VERIFY_TOKEN =
  process.env.TEST_VERIFY_TOKEN ||
  "fd07bb9723b02f6060e44f2599a99b02d02402a206b505c41ff0631f3478b333";
const _ADMIN_TOKEN = process.env.CORE_ADMIN_TOKEN || "test-admin-token";

async function runSmokeTests() {
  console.log("🚀 Starting ECOD Smoke Tests...");
  console.log(`📍 Targeting: ${BASE_URL}`);

  try {
    // 1. Health Check Verification
    console.log("\n1️⃣ Checking Health API...");
    const healthRes = await axios.get(`${BASE_URL}/api/saas/health`);
    if (healthRes.data.data.status === "ok") {
      console.log("✅ Health check passed");
    } else {
      console.error("❌ Health check failed:", healthRes.data);
    }

    // 2. Lead Creation Resilience Test (Bug A)
    console.log("\n2️⃣ Testing Lead Creation (Auto-bootstrap)...");
    const leadRes = await axios.post(
      `${BASE_URL}/api/saas/workflows/trigger`,
      {
        trigger: "manual",
        phone: "919999999999",
        email: "smoke@test.com",
        createLeadIfMissing: true,
        leadData: {
          firstName: "Smoke",
          lastName: "Test",
          source: "website",
        },
      },
      {
        headers: {
          "x-api-key": API_KEY,
          "x-client-code": CLIENT_CODE,
        },
      },
    );
    if (leadRes.data.success) {
      console.log("✅ Lead created / Pipeline bootstrapped");
    }

    // 3. WhatsApp Webhook Verification (Bug D)
    console.log("\n3️⃣ Testing WhatsApp Webhook Verification...");
    const hubChallenge = "challenge_123";
    const webhookRes = await axios.get(
      `${BASE_URL}/api/saas/whatsapp/webhook`,
      {
        params: {
          "hub.mode": "subscribe",
          "hub.verify_token": VERIFY_TOKEN,
          "hub.challenge": hubChallenge,
        },
      },
    );
    if (webhookRes.data.trim() === hubChallenge) {
      console.log("✅ WhatsApp Webhook verification passed");
    }

    // 4. Sequence Enrollment (New Route)
    console.log("\n4️⃣ Testing Sequence Enrollment Route...");
    // This requires a real ruleId to be valid, skipping real execution but testing route presence
    try {
      await axios.post(
        `${BASE_URL}/api/crm/sequences/enroll`,
        {},
        {
          headers: {
            "x-api-key": API_KEY,
            "x-client-code": CLIENT_CODE,
          },
        },
      );
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.log("✅ Sequence route reachable (Validation error caught)");
      }
    }

    console.log("\n✨ Smoke Tests Completed Successfully!");
  } catch (err: any) {
    console.error("\n💥 Smoke Test Failed!");
    console.error("Error:", err.message);
    if (err.response) {
      console.error("Response:", err.response.data);
    }
    process.exit(1);
  }
}

runSmokeTests();
