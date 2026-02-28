import express, { type Request, type Response } from "express";
import { google } from "googleapis";
import { renderView } from "../../lib/renderView.ts";
import { Client } from "../../model/clients/client.ts";
import { ClientSecrets } from "../../model/clients/secrets.ts";

const router = express.Router();

/**
 * Initiate Google OAuth Flow
 * GET /api/auth/google/connect?clientCode=...
 */
router.get("/connect", async (req: Request, res: Response) => {
  try {
    const { clientCode } = req.query;

    if (!clientCode) {
      return res.status(400).send("Missing clientCode");
    }

    // 1. Fetch Client ID & Secret from DB
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) {
      return res.status(404).send("Client secrets not found");
    }

    const clientId = secrets.getDecrypted("googleClientId");
    const clientSecret = secrets.getDecrypted("googleClientSecret");

    if (!clientId || !clientSecret) {
      return res
        .status(400)
        .send("Google Client ID and Secret must be configured first");
    }

    // 2. Create OAuth Client
    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    const oauth2Client = new google.auth.OAuth2(
      clientId as string,
      clientSecret as string,
      redirectUri,
    );

    // 3. Generate Auth URL
    const scopes = ["https://www.googleapis.com/auth/calendar.events"];

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline", // Crucial for receiving refresh token
      scope: scopes,
      state: clientCode as string, // Pass clientCode as state to identify on callback
      prompt: "consent", // Force consent to ensure refresh token is returned
    });

    // 4. Redirect User
    res.redirect(url);
  } catch (error) {
    console.error("OAuth Connect Error:", error);
    res.status(500).send("Internal Server Error during OAuth initiation");
  }
});

/**
 * Handle Google OAuth Callback
 * GET /api/auth/google/callback?code=...&state=...
 */
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const { code, state: clientCode } = req.query;

    if (!code || !clientCode) {
      return res.status(400).send("Missing code or state");
    }

    // 1. Fetch Client ID & Secret again (stateless)
    const secrets = await ClientSecrets.findOne({ clientCode });
    if (!secrets) {
      return res.status(404).send("Client configuration not found");
    }

    const clientId = secrets.getDecrypted("googleClientId");
    const clientSecret = secrets.getDecrypted("googleClientSecret");

    if (!clientId || !clientSecret) {
      return res
        .status(400)
        .send("Google Client ID and Secret are missing in configuration");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    const oauth2Client = new google.auth.OAuth2(
      clientId as string,
      clientSecret as string,
      redirectUri,
    );

    // 2. Exchange Code for Tokens
    const { tokens } = await oauth2Client.getToken(code as string);

    if (!tokens.refresh_token) {
      console.warn(
        "No refresh token received. User might have already authorized the app.",
      );
      // Ideally handled by prompt: 'consent' in generateAuthUrl
    }

    // 3. Update Secrets with Refresh Token
    // We only care about the refresh token for long-term server-side usage
    if (tokens.refresh_token) {
      secrets.googleRefreshToken = tokens.refresh_token;
      // Note: Encryption happens in pre-save hook automatically
      await secrets.save();
    }

    // 4. Fetch Client Name for Personalization
    const client = await Client.findOne({ clientCode }, "name business");
    const businessName = client?.name || "Your Business";
    const website = client?.business?.website;

    // 5. Success Response
    const html = renderView("auth/google-success.html", {
      BUSINESS_NAME: businessName,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    console.error("OAuth Callback Error:", error);
    res
      .status(500)
      .send(
        "Authentication failed. Please check the logs or try again. " +
          error.message,
      );
  }
});

export default router;
