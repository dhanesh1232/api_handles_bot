import crypto from "crypto";
import { dbConnect } from "./config.ts";

export interface CallbackPayload {
  clientCode: string;
  callbackUrl: string;
  method?: "PUT" | "POST";
  payload: object;
  jobId?: string;
  enrollmentId?: string;
  maxRetries?: number;
}

export async function sendCallbackWithRetry(
  options: CallbackPayload,
): Promise<{ success: boolean; attempts: number; status?: number }> {
  const {
    clientCode,
    callbackUrl,
    method = "PUT",
    payload,
    jobId,
    enrollmentId,
    maxRetries = 3,
  } = options;

  // Get client secret for HMAC signing
  await dbConnect("services");
  const { ClientSecrets } = await import("../model/clients/secrets.ts");
  const secrets = await ClientSecrets.findOne({ clientCode });
  const clientSecret =
    (secrets as any)?.getDecrypted("automationWebhookSecret") ?? "";

  const body = JSON.stringify(payload);
  const signature = clientSecret
    ? "sha256=" +
      crypto.createHmac("sha256", clientSecret).update(body).digest("hex")
    : "";

  let attempts = 0;
  let lastStatus = 0;

  while (attempts < maxRetries) {
    attempts++;
    try {
      const res = await fetch(callbackUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-ECODrix-Signature": signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      lastStatus = res.status;

      if (res.ok) {
        // Log success
        await logCallback({
          clientCode,
          callbackUrl,
          method,
          payload,
          jobId,
          enrollmentId,
          signature,
          responseStatus: lastStatus,
          status: "sent",
          attempts,
          responseBody: await res.text().catch(() => ""),
        });
        return { success: true, attempts, status: lastStatus };
      }

      console.warn(
        `[callback] Attempt ${attempts}/${maxRetries} got ${lastStatus}: ${callbackUrl}`,
      );
    } catch (err: any) {
      console.warn(
        `[callback] Attempt ${attempts}/${maxRetries} error: ${err.message}`,
      );
    }

    if (attempts < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempts - 1)));
    }
  }

  // Log failure
  await logCallback({
    clientCode,
    callbackUrl,
    method,
    payload,
    jobId,
    enrollmentId,
    signature,
    responseStatus: lastStatus,
    status: "failed",
    attempts,
    responseBody: "",
  });

  return { success: false, attempts, status: lastStatus };
}

async function logCallback(data: {
  clientCode: string;
  callbackUrl: string;
  method: string;
  payload: object;
  jobId?: string;
  enrollmentId?: string;
  signature: string;
  responseStatus: number;
  responseBody: string;
  status: "sent" | "failed";
  attempts: number;
}): Promise<void> {
  try {
    const { CallbackLog } =
      await import("../model/saas/event/callbackLog.model.ts");
    await CallbackLog.create({
      ...data,
      lastAttemptAt: new Date(),
    });
  } catch (err: any) {
    console.error("[callback] Failed to write CallbackLog:", err.message);
  }
}
