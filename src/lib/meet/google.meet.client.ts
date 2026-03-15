/**
 * lib/meet/google.meet.client.ts
 *
 * GoogleMeetClient — Unified wrapper for Google Calendar API.
 */

import { logger } from "@lib/logger";
import { type Auth, google } from "googleapis";

export class GoogleMeetClient {
  private readonly auth: Auth.OAuth2Client;
  private readonly clientCode: string;
  private readonly log = logger.child({ module: "GoogleMeetClient" });

  constructor(clientCode: string, config: GoogleMeetConfig) {
    this.clientCode = clientCode;
    this.auth = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );

    this.auth.setCredentials({ refresh_token: config.refreshToken });
  }

  /**
   * Factory from secrets.
   */
  static fromSecrets(
    clientCode: string,
    secrets: { getDecrypted: (key: string) => string | null | undefined },
    baseUrl: string,
  ): GoogleMeetClient {
    const clientId = secrets.getDecrypted("googleClientId");
    const clientSecret = secrets.getDecrypted("googleClientSecret");
    const refreshToken = secrets.getDecrypted("googleRefreshToken");

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(`Google credentials missing for client: ${clientCode}`);
    }

    return new GoogleMeetClient(clientCode, {
      clientId: clientId as string,
      clientSecret: clientSecret as string,
      refreshToken: refreshToken as string,
      redirectUri: `${baseUrl}/api/auth/google/callback`,
    });
  }

  /**
   * Create a Google Meet event.
   */
  async createMeeting(input: MeetingInput) {
    try {
      const calendar = google.calendar({ version: "v3", auth: this.auth });

      const event = {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start, timeZone: "UTC" },
        end: { dateTime: input.end, timeZone: "UTC" },
        attendees: input.attendees?.map((email) => ({ email })),
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

      this.log.debug(
        { eventId: response.data.id, clientCode: this.clientCode },
        "Meeting created",
      );

      return {
        hangoutLink: hangoutLink as string | undefined,
        eventId: response.data.id as string | undefined,
        summary: response.data.summary as string | undefined,
      };
    } catch (err) {
      this.log.error(
        { err, clientCode: this.clientCode },
        "Failed to create meeting",
      );
      throw err;
    }
  }
}
