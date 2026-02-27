import { google, type Auth } from "googleapis";
import { ClientSecrets } from "../../../model/clients/secrets.ts";

/**
 * Google Meet Integration Service
 *
 * Handles generating meeting links and managing calendar events for tenants.
 */

const url = process.env.BASE_URL || "http://localhost:4000";

export interface MeetingDetails {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  attendees?: string[];
}

export interface GoogleMeetResponse {
  success: boolean;
  hangoutLink?: string;
  eventId?: string;
  summary?: string;
  error?: string;
}

export const createGoogleMeetService = () => {
  /**
   * Get OAuth2 Client for a specific client
   * @param clientCode
   */
  const getAuthClient = async (
    clientCode: string,
  ): Promise<Auth.OAuth2Client> => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    const clientId = secrets.getDecrypted("googleClientId");
    const clientSecret = secrets.getDecrypted("googleClientSecret");
    const refreshToken = secrets.getDecrypted("googleRefreshToken");

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Google credentials not configured for this client");
    }

    const oAuth2Client = new google.auth.OAuth2(
      clientId as string,
      clientSecret as string,
      `${url}/api/auth/google/callback`,
    );

    oAuth2Client.setCredentials({ refresh_token: refreshToken as string });
    return oAuth2Client;
  };

  /**
   * Create a Google Meet event
   */
  const createMeeting = async (
    clientCode: string,
    meetingDetails: MeetingDetails,
  ): Promise<GoogleMeetResponse> => {
    try {
      const auth = await getAuthClient(clientCode);
      const calendar = google.calendar({ version: "v3", auth });

      const {
        summary,
        description,
        start,
        end,
        attendees = [],
      } = meetingDetails;

      const event = {
        summary: summary || "Business Consultation",
        description: description || "Scheduled via ECODrIx Bot",
        start: {
          dateTime: start || new Date().toISOString(),
          timeZone: "UTC",
        },
        end: {
          dateTime: end || new Date(Date.now() + 30 * 60000).toISOString(), // +30 mins
          timeZone: "UTC",
        },
        attendees: attendees.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: `meet_${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      };

      const response = await calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
        conferenceDataVersion: 1,
      });

      let hangoutLink = response.data.hangoutLink;
      if (!hangoutLink && response.data.conferenceData?.entryPoints) {
        const meetPoint = response.data.conferenceData.entryPoints.find(
          (ep) => ep.entryPointType === "video",
        );
        hangoutLink = meetPoint?.uri;
      }

      return {
        success: true,
        hangoutLink: hangoutLink as string | undefined,
        eventId: response.data.id as string | undefined,
        summary: response.data.summary as string | undefined,
      };
    } catch (error: any) {
      console.error(`❌ Google Meet Error [${clientCode}]:`, error.message);
      return { success: false, error: error.message };
    }
  };

  return {
    createMeeting,
  };
};
