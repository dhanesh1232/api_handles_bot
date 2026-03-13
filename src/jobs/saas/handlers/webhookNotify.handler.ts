import { JobHandler } from "../base.handler";
import type { IJob } from "@models/queue/job.model";
import { sendCallbackWithRetry } from "@lib/callbackSender";

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
