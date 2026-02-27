import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, url } = req;
  const clientCode = (req as any).clientCode ?? "-";

  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
    console.log(
      `[${level}] ${method} ${url} ${status} ${ms}ms client=${clientCode}`
    );
  });

  next();
}
