import { dbConnect } from "@lib/config";
import { Client, type IClient } from "@models/clients/client";
import type { NextFunction, Request, Response } from "express";

// AuthRequest now inherits from the augmented Express.Request
export interface AuthRequest extends Request {
  // clientCode?: string; // Inherited from augmented Request
}

/**
 * Express middleware that validates the `x-api-key` and resolves the tenant's `clientCode`.
 *
 * **GOAL:** Ensure that every request hitting the SaaS/CRM routes is properly authenticated and tied to a valid client record.
 *
 * **DETAILED EXECUTION:**
 * 1. **Header Analysis**: Extracts `x-api-key` and the optional `x-client-code`.
 * 2. **Authentication Flow**:
 *    - Explicit Mode: If `clientCode` is provided, it fetches the client by code and verifies the key matches.
 *    - Implicit Mode: If `clientCode` is missing, it performs a reverse lookup using the `apiKey`.
 * 3. **Context Injection**: Normalizes the `clientCode` to uppercase and attaches it to `req.clientCode` for downstream middleware.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Missing Key: Terminates with `401 Unauthorized`.
 * - Invalid/Mismatched Key: Terminates with `403 Forbidden` to prevent "probing" attacks.
 * - Database Latency: Uses `dbConnect("services")` to ensure the Control Plane is ready.
 */
export async function validateClientKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  // CORS handles OPTIONS, but just in case it leaks through or is misconfigured, don't block it with auth
  if (req.method === "OPTIONS") {
    return next();
  }
  const apiKey = req.headers["x-api-key"] as string | undefined;
  const clientCode = req.headers["x-client-code"] as string | undefined;

  if (!apiKey) {
    return res.status(401).json({ error: "Unauthorized: Missing API Key" });
  }

  try {
    await dbConnect("services");
    let client: IClient | null = null;

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
  } catch (err: any) {
    console.error("❌ Auth Error:", err);
    res.status(500).json({ error: "Internal Server Error during auth" });
  }
}
