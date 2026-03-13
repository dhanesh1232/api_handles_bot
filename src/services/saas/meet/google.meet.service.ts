import { ClientSecrets } from "@models/clients/secrets";
import {
  GoogleMeetClient,
  type MeetingInput,
} from "@lib/meet/google.meet.client";
import { getClientConfig } from "@lib/tenant/get.crm.model";
import { tenantLogger } from "@lib/logger";

/**
 * Google Meet Integration Service
 *
 * Handles generating meeting links and managing calendar events for tenants.
 */

const baseUrl = process.env.BASE_URL || "http://localhost:4000";

export const createGoogleMeetService = () => {
  /**
   * Internal helper to get GoogleMeetClient for a client
   */
  const getClient = async (clientCode: string) => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    return GoogleMeetClient.fromSecrets(clientCode, secrets, baseUrl);
  };

  /**
   * Create a Google Meet event
   */
  const createMeeting = async (
    clientCode: string,
    meetingDetails: Partial<MeetingInput>,
  ): Promise<GoogleMeetResponse> => {
    const log = tenantLogger(clientCode);
    try {
      const client = await getClient(clientCode);
      const clientConfig = await getClientConfig(clientCode);

      const result = await client.createMeeting({
        summary: meetingDetails.summary || "Meeting",
        description:
          meetingDetails.description || `Scheduled via ${clientConfig.name}`,
        start: meetingDetails.start || new Date().toISOString(),
        end:
          meetingDetails.end || new Date(Date.now() + 30 * 60000).toISOString(),
        attendees: meetingDetails.attendees,
      });

      return {
        success: true,
        hangoutLink: result.hangoutLink,
        eventId: result.eventId,
        summary: result.summary,
      };
    } catch (error: any) {
      log.error(
        { err: error },
        `Google Meet creation failed: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  };

  return {
    createMeeting,
  };
};
