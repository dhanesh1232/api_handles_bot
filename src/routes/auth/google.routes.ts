import dns from "node:dns";
import express, { type Request, type Response } from "express";
import { google } from "googleapis";
import { renderView } from "@/lib/renderView";
import { Client } from "@/model/clients/client";
import { ClientSecrets } from "@/model/clients/secrets";

// Fix for ETIMEDOUT issues on some networks where IPv6 is advertised but not working.
// Node.js 18+ defaults to happy-eyeballs which can sometimes wait too long for IPv6.
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

// Global configuration for Google API client to handle slow networks and transient errors.
google.options({
  timeout: 60000, // 60 seconds
  retry: true,
  retryConfig: {
    retry: 3,
    retryDelay: 1000,
    httpMethodsToRetry: [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ],
    statusCodesToRetry: [
      [100, 199],
      [429, 429],
      [500, 599],
    ],
  },
});

const router = express.Router();

/**
 * @module Routes/Auth/Google
 * @responsibility Google OAuth2 handshaking for Calendar/Meet integration.
 *
 * **GOAL:** Orchestrate the multi-step OAuth flow to obtain a `refreshToken` from Google, enabling the server to schedule meetings on behalf of the tenant.
 *
 * **DETAILED EXECUTION:**
 * 1. **Connection Initiation**: Fetches encrypted `googleClientId` and `googleClientSecret` to generate a signed redirect URL.
 * 2. **Token Exchange**: Receives the `code` from Google, performs a server-side handshake (forcing IPv4 to avoid network timeouts), and persists the `refreshToken`.
 * 3. **Success Visualization**: Renders a branded `google-success.html` view once the connection is verified.
 *
 * **EDGE CASE MANAGEMENT:**
 * - IPv6 Timeouts: Forces `family: 4` in the token exchange to bypass common misconfigurations in WSL/Docker environments.
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
    // We'll use a manual POST request with a high timeout to bypass any gaxios/google-auth-library quirks.
    console.log("📡 Exchanging code for tokens manually...");
    const axios = (await import("axios")).default;

    let tokens: any;
    try {
      const response = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          code: code as string,
          client_id: clientId as string,
          client_secret: clientSecret as string,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 60000, // 60 seconds
          family: 4, // Force IPv4 to avoid time-out issues on some systems (WSL/IPv6)
        },
      );
      tokens = response.data;
      console.log("✅ Tokens received successfully");
    } catch (axiosError: any) {
      console.error(
        "❌ Token Exchange failed via manual axios:",
        axiosError.message,
      );
      if (axiosError.response) {
        console.error("Response data:", axiosError.response.data);
      }
      throw axiosError;
    }

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
    const _website = client?.business?.website;

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
