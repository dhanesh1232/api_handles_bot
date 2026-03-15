import { sendCallbackWithRetry } from "@lib/callbackSender";
import type { IJob } from "@models/queue/job.model";
import { JobHandler } from "../base.handler";

export class WebhookNotifyJobHandler extends JobHandler {
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
