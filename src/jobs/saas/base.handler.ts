import { logger } from "@lib/logger";
import type { IJob } from "@models/queue/job.model";

export abstract class JobHandler {
  protected readonly log = logger.child({ module: this.constructor.name });

  /**
   * Execute the job logic.
   * @param clientCode The tenant client code.
   * @param payload The job payload.
   * @param job The raw job object from the queue.
   */
  abstract handle(clientCode: string, payload: any, job: IJob): Promise<void>;

  /**
   * Optional cleanup or side-effects after successful execution.
   */
  protected async onComplete?(clientCode: string, payload: any): Promise<void>;

  /**
   * Optional error handling logic specific to this job type.
   */
  protected async onError?(
    clientCode: string,
    payload: any,
    err: any,
  ): Promise<void>;
}
