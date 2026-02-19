import { google } from "googleapis";
import { ClientSecrets } from "../../model/clients/secrets.js";

/**
 * Google Meet Integration Service
 *
 * Handles generating meeting links and managing calendar events for tenants.
 */

const url = "http://localhost:4000" || "https://api.ecodrix.com";

export const createGoogleMeetService = () => {
  /**
   * Get OAuth2 Client for a specific client
   * @param {string} clientCode
   */
  const getAuthClient = async (clientCode) => {
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) throw new Error("Client secrets not found");

    const clientId = secrets.getDecrypted("googleClientId");
    const clientSecret = secrets.getDecrypted("googleClientSecret");
    const refreshToken = secrets.getDecrypted("googleRefreshToken");

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Google credentials not configured for this client");
    }

    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${url}/api/auth/google/callback`,
    );

    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    return oAuth2Client;
  };

  /**
   * Create a Google Meet event
   */
  const createMeeting = async (clientCode, meetingDetails) => {
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
        resource: event,
        conferenceDataVersion: 1,
      });

      return {
        success: true,
        hangoutLink: response.data.hangoutLink,
        eventId: response.data.id,
        summary: response.data.summary,
      };
    } catch (error) {
      console.error(`❌ Google Meet Error [${clientCode}]:`, error.message);
      return { success: false, error: error.message };
    }
  };

  return {
    createMeeting,
  };
};
