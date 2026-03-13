/**
 * sdk/meet.sdk.ts
 */

import { dbConnect } from "@lib/config";
import { ClientSecrets } from "@models/clients/secrets";
import { getClientConfig } from "@lib/tenant/get.crm.model";
import {
  GoogleMeetClient,
  type MeetingInput,
} from "@lib/meet/google.meet.client";

export class MeetSDK {
  private readonly baseUrl = process.env.BASE_URL || "http://localhost:4000";

  constructor(private readonly clientCode: string) {}

  private async getClient() {
    await dbConnect("services");
    const secrets = await ClientSecrets.findOne({
      clientCode: this.clientCode,
    });
    if (!secrets) throw new Error("Client secrets not found");

    return GoogleMeetClient.fromSecrets(this.clientCode, secrets, this.baseUrl);
  }

  /**
   * Create a scheduled meeting.
   */
  async create(input: Partial<MeetingInput>) {
    const client = await this.getClient();
    const config = await getClientConfig(this.clientCode);

    return client.createMeeting({
      summary: input.summary || "Meeting",
      description: input.description || `Scheduled via ${config.name}`,
      start: input.start || new Date().toISOString(),
      end: input.end || new Date(Date.now() + 30 * 60000).toISOString(),
      attendees: input.attendees,
    });
  }
}
