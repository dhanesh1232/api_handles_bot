/**
 * @file meet.sdk.ts
 * @module MeetSDK
 * @responsibility Facade for scheduling and managing Google Meet appointments.
 * @dependencies GoogleMeetClient, ClientSecrets
 */

import { dbConnect } from "@lib/config";
import { GoogleMeetClient } from "@lib/meet/google.meet.client";
import { getClientConfig } from "@lib/tenant/crm.models";
import { ClientSecrets } from "@models/clients/secrets";

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
   * Schedules a new video meeting via Google Meet.
   *
   * **WORKING PROCESS:**
   * 1. Lazily initializes a `GoogleMeetClient` using the tenant's OAuth secrets.
   * 2. Fetches `ClientServiceConfig` to personalize meeting descriptions.
   * 3. Sends the creation request to the Google Calendar API.
   * 4. Returns the meeting link, event ID, and metadata.
   *
   * @param {Partial<MeetingInput>} input - Meeting details (summary, start/end, attendees).
   * @returns {Promise<MeetingResult>}
   * @edge_case Throws an error if the tenant haven't completed the Google Workspace onboarding.
   */
  async create(input: Partial<MeetingInput>) {
    const client = await this.getClient();
    const config = await getClientConfig(this.clientCode);

    return client.createMeeting({
      summary: input.summary || "Meeting",
      description: input.description || `Scheduled via ${config?.name}`,
      start: input.start || new Date().toISOString(),
      end: input.end || new Date(Date.now() + 30 * 60000).toISOString(),
      attendees: input.attendees,
    });
  }
}
