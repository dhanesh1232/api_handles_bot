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
   * Sends a callback with automatic HMAC signing and retries.
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
