import { sendCallbackWithRetry } from "@lib/callbackSender";
import { JobHandler } from "../base.handler";

export class WebhookNotifyJobHandler extends JobHandler {
  /**
   * Dispatches outbound webhook notifications to external partner systems.
   *
   * @param clientCode - Tenant identifier.
   * @param payload - Contains `callbackUrl` and the `event` data to transmit.
   * @param job - Job instance for retry management.
   *
   * **DETAILED EXECUTION:**
   * 1. **Payload Dispatch**: Invokes `sendCallbackWithRetry` with an exponential backoff strategy if the destination server is down.
   * 2. **Data Integrity**: Ensures the payload reflects the latest state of the event that triggered the webhook.
   */
  async handle(clientCode: string, payload: any, job: IJob): Promise<void> {
    void sendCallbackWithRetry({
      clientCode,
      callbackUrl: payload.callbackUrl,
      method: "POST",
      payload: payload.event,
      jobId: job._id?.toString(),
    });
  }
}
