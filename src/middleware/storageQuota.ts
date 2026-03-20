import { logger } from "@lib/logger";
import { ClientStorage } from "@models/clients/ClientStorage";
import { type NextFunction, type Response } from "express";

/**
 * Guard middleware that enforces tenant-specific storage limits and account suspension states.
 *
 * **DETAILED EXECUTION:**
 * 1. **Client Identification**: Retrieves `req.clientCode` set by the auth layer.
 * 2. **Account Pulse Check**: Queries `ClientStorage` for the tenant's current usage metrics and `isSuspended` flag.
 * 3. **Quota Math**: Invokes `isOverQuota()` on the storage model to compare `usedBytes` against `allocatedBytes`.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Missing Record: Logs a warning but allows the request (`fail-open`) to avoid breaking fresh accounts.
 * - Suspended Account: Returns `403 Forbidden` for all write-adjacent operations.
 * - Over Quota: Returns `403 Forbidden` explicitly mentioning the storage limit.
 */
export const storageQuota = async (
  req: any,
  res: Response,
  next: NextFunction,
) => {
  const { clientCode } = req;
  if (!clientCode) return next();

  try {
    const storage = await ClientStorage.findOne({ clientCode });
    if (!storage) {
      logger.warn(
        { clientCode },
        "[Middleware: storageQuota] Storage record missing for client",
      );
      return next();
    }

    if (storage.isSuspended) {
      return res.status(403).json({
        success: false,
        message:
          "Storage suspended. Please contact support or upgrade your plan.",
      });
    }

    if (storage.isOverQuota()) {
      return res.status(403).json({
        success: false,
        message:
          "Storage quota exceeded. Please upgrade your plan or delete some files.",
      });
    }

    next();
  } catch (err: any) {
    logger.error(
      { err: err.message, clientCode },
      "[Middleware: storageQuota] Error checking quota",
    );
    next(); // Fail-open to not block critical operations
  }
};
