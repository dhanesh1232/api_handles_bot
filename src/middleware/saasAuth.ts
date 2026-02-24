import type { NextFunction, Request, Response } from "express";
import { dbConnect } from "../lib/config.ts";
import { Client, type IClient } from "../model/clients/client.ts";

// AuthRequest now inherits from the augmented Express.Request
export interface AuthRequest extends Request {
  // clientCode?: string; // Inherited from augmented Request
}

/**
 * Middleware: Validate Client API Key
 * Supports finding client by 'clientCode' (body/query) + Key check
 * OR finding client directly by Key.
 * @param {AuthRequest} req - The request object
 * @param {Response} res - The response object
 * @param {NextFunction} next - The next function
 */
export async function validateClientKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
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
