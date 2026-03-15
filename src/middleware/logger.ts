import { requestChild } from "@lib/logger";
import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, url } = req;

  // Attach a contextual child logger to the request
  req.log = requestChild(req);

  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const clientCode = req.clientCode ?? "-";

    req.log.info(
      {
        status,
        duration: `${ms}ms`,
        clientCode,
      },
      `${method} ${url} ${status} ${ms}ms`,
    );
  });

  next();
}
