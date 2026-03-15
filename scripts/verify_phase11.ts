import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const API_BASE = "http://localhost:4000/api";
const CLIENT_CODE = "ERIX_CLNT1";
const API_KEY = "ERIXDE022108B494597415C47FFB09C25EC1355B9E0564A5515D";

async function verifyPipelineAssignment() {
  console.log("Testing Lead Upsert with Pipeline Assignment...");

  try {
    const response = await axios.post(
      `${API_BASE}/crm/leads/upsert`,
      {
        leadData: {
          name: "Verification Test Lead",
          phone: "910000000001",
          email: "test@example.com",
          source: "verification_test",
        },
        pipelineName: "Doctor Appointment",
        trigger: "doctor_consultation",
      },
      {
        headers: {
          "x-client-code": CLIENT_CODE,
          "x-client-key": API_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("Response Status:", response.status);
    console.log("Lead ID:", response.data.data._id);
    console.log("Assigned Pipeline ID:", response.data.data.pipelineId);
    console.log("Assigned Stage ID:", response.data.data.stageId);

    if (response.data.data.pipelineId) {
      console.log("✅ Success: Lead successfully assigned to a pipeline.");
    } else {
      console.log("❌ Failure: Lead has no pipelineId assigned.");
    }
  } catch (error: any) {
    console.error(
      "Error during verification:",
      error.response?.data || error.message,
    );
  }
}

verifyPipelineAssignment();
