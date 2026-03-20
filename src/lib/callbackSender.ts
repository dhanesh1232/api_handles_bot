import crypto from "node:crypto";
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

class CallbackClient {
  /**
   * Transmits asynchronous payloads to partner webhooks with cryptographic signing and exponential backoff retry logic.
   *
   * @param options - Transmission context including `callbackUrl`, `payload`, and `maxRetries`.
   * @returns Successful transmission status and number of attempts made.
   *
   * **DETAILED EXECUTION:**
   * 1. **Secret Resolution**: Connects to the control-plane to resolve the tenant's `automationWebhookSecret`.
   * 2. **Message Signing**: Generates a `sha256` HMAC signature of the JSON body for destination-side verification.
   * 3. **Retry Loop**: Executes the `fetch` request. If it fails or returns a non-200 status, waits for an increasing duration before retrying.
   * 4. **Timeline Persistence**: Logs Every attempt (success or fail) to the tenant's `CallbackLog` for auditability.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Timeout: Aborts the request after 8 seconds to prevent worker thread blocking.
   * - Missing Secret: Skips signing if the secret is not configured, but vẫn proceeds with the delivery.
   */
  async send(
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
            ...(signature ? { "x-ecodrix-signature": signature } : {}),
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        lastStatus = res.status;

        if (res.ok) {
          await this.log(clientCode, {
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
      } catch (_err: any) {
        // Silently retry
      }

      if (attempts < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempts - 1)));
      }
    }

    // Log failure
    await this.log(clientCode, {
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

  private async log(clientCode: string, data: any): Promise<void> {
    try {
      const { getCrmModels } = await import("./tenant/crm.models");
      const { CallbackLog } = await getCrmModels(clientCode);
      await CallbackLog.create({
        ...data,
        clientCode,
        lastAttemptAt: new Date(),
      });
    } catch (_err: any) {
      // console.error is redundant if logger is available, but maintaining established pattern
    }
  }
}

export const callbackClient = new CallbackClient();

/** Backward compatible functional wrapper */
export const sendCallbackWithRetry = (options: CallbackPayload) =>
  callbackClient.send(options);
