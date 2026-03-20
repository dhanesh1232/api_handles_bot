import { tenantLogger } from "@lib/logger";
import { GoogleMeetClient } from "@lib/meet/google.meet.client";
import { getClientConfig } from "@lib/tenant/crm.models";
import { ClientSecrets } from "@models/clients/secrets";

/**
 * Google Meet Integration Service
 *
 * Handles generating meeting links and managing calendar events for tenants.
 */

const baseUrl = process.env.BASE_URL || "http://localhost:4000";

export const createGoogleMeetService = () => {
  /**
   * Internal helper to get GoogleMeetClient for a client
   * @param clientCode - The client code
   * @returns GoogleMeetClient
   */
  const getClient = async (clientCode: string) => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    return GoogleMeetClient.fromSecrets(clientCode, secrets, baseUrl);
  };

  /**
   * Create a Google Meet event
   * @param clientCode - The client code
   * @param meetingDetails - The meeting details
   * @returns GoogleMeetResponse
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
          meetingDetails.description || `Scheduled via ${clientConfig?.name}`,
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
      return {
        success: false,
        error: error.message,
      };
    }
  };

  /**
   * Delete a Google Meet event
   * @param clientCode - The client code
   * @param eventId - The event ID
   * @returns \{ success: boolean; error?: string \}
   */
  const deleteMeeting = async (
    clientCode: string,
    eventId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const log = tenantLogger(clientCode);
    try {
      const client = await getClient(clientCode);
      await client.deleteMeeting(eventId);
      return { success: true };
    } catch (error: any) {
      log.error(
        { err: error, eventId },
        `Google Meet deletion failed: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  };

  /**
   * Update a Google Meet event
   * @param clientCode - The client code
   * @param eventId - The event ID
   * @param meetingDetails - The meeting details
   * @returns GoogleMeetResponse
   */
  const updateMeeting = async (
    clientCode: string,
    eventId: string,
    meetingDetails: Partial<MeetingInput>,
  ): Promise<GoogleMeetResponse> => {
    const log = tenantLogger(clientCode);
    try {
      const client = await getClient(clientCode);

      const result = await client.updateMeeting(eventId, {
        summary: meetingDetails.summary || "Meeting",
        description: meetingDetails.description || "Updated meeting",
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
        { err: error, eventId },
        `Google Meet update failed: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  };

  return {
    createMeeting,
    deleteMeeting,
    updateMeeting,
  };
};
