import "dotenv/config";
import type { NextFunction, Request, Response } from "express";

/**
 * Middleware to verify the core API key for internal automated requests
 * @param req - Request object
 * @param res - Response object
 * @param next - Next function
 *
 * @returns {void}
 *
 * @throws {Error}
 *
 * @example
 * verifyCoreToken(req, res, next);
 */
export const verifyCoreToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers["x-core-api-key"];
  const expectedToken =
    process.env.CORE_API_KEY || "EmraK+U2worp7R5TpNVkqpmYa6v2OKiX+fqLbuHRcNA=";

  if (!token || token !== expectedToken) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Invalid Core API Key" });
  }
  next();
};
