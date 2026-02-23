import express from "express";
import { google } from "googleapis";
import { ClientSecrets } from "../../model/clients/secrets.js";

const router = express.Router();

/**
 * Initiate Google OAuth Flow
 * GET /api/auth/google/connect?clientCode=...
 */
router.get("/connect", async (req, res) => {
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
      clientId,
      clientSecret,
      redirectUri,
    );

    // 3. Generate Auth URL
    const scopes = ["https://www.googleapis.com/auth/calendar.events"];

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline", // Crucial for receiving refresh token
      scope: scopes,
      state: clientCode, // Pass clientCode as state to identify on callback
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
router.get("/callback", async (req, res) => {
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
      clientId,
      clientSecret,
      redirectUri,
    );

    // 2. Exchange Code for Tokens
    const { tokens } = await oauth2Client.getToken(code);

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

    // 4. Success Response
    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #4caf50;">Connection Successful!</h1>
        <p>Google Meet integration is now active for client <strong>${clientCode}</strong>.</p>
        <p>You can close this window and return to the Admin Panel.</p>
        <script>
            setTimeout(() => window.close(), 5000);
        </script>
      </div>
    `);
  } catch (error) {
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
