import { dbConnect } from "../lib/config.js";
import { Client } from "../model/clients/client.js";

/**
 * Middleware: Validate Client API Key
 * Supports finding client by 'clientCode' (body/query) + Key check
 * OR finding client directly by Key.
 */
export async function validateClientKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const clientCode = req.headers["x-client-code"];
  // console.log(apiKey, clientCode);
  if (!apiKey) {
    return res.status(401).json({ error: "Unauthorized: Missing API Key" });
  }

  try {
    await dbConnect("services");
    let client;

    // If clientCode is provided, verify against it
    if (clientCode) {
      client = await Client.findOne({ clientCode: clientCode.toUpperCase() });
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (client.apiKey !== apiKey) {
        return res.status(403).json({ error: "Forbidden: Invalid API Key" });
      }
    } else {
      // Otherwise find client by API Key
      client = await Client.findOne({ apiKey });
      if (!client) {
        return res.status(403).json({ error: "Forbidden: Invalid API Key" });
      }
      // Attach to request for downstream use - MUTATING REQ
      req.clientCode = client.clientCode;
    }

    if (!req.clientCode && client) req.clientCode = client.clientCode;

    next();
  } catch (err) {
    console.error("❌ Auth Error:", err);
    res.status(500).json({ error: "Internal Server Error during auth" });
  }
}
