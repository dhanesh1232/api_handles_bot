import { logger } from "@lib/logger";
import { ClientStorage } from "@models/clients/ClientStorage";
import { type NextFunction, type Response } from "express";

/**
 * Middleware: Blocks requests if the client's storage quota is exceeded or suspended.
 * Must be used AFTER validateClientKey middleware.
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
