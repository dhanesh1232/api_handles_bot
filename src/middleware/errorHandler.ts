/**
 * Global application error interceptor and response normalizer.
 *
 * **GOAL:** Convert logical failures (TypeErrors, ValidationErrors, AppErrors) into predictable, standardized JSON responses.
 *
 * **DETAILED EXECUTION:**
 * 1. **Zod Trap**: Captures schema violations and flattens them into a `Record<fieldName, errorMessage[]>` structure for frontend display.
 * 2. **AppError Resolution**: Maps custom domain errors (`NotFoundError`, `AppError`) to their specified HTTP status codes and machine-readable `code` identifiers.
 * 3. **OpSec Production Masking**: In `production`, internal 5xx errors are stripped of their generic messages to prevent information leakage, returning "Internal Server Error" instead.
 * 4. **Diagnostic Logging**: Every error is logged via `logger` with request metadata (`url`, `method`) for easier debugging.
 */

import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isAppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * @module Middleware/ErrorHandler
 * @responsibility Global application error interceptor and response normalizer.
 *
 * **GOAL:** Convert logical failures (TypeErrors, ValidationErrors, AppErrors) into predictable, standardized JSON responses.
 *
 * **DETAILED EXECUTION:**
 * 1. **Zod Trap**: Captures schema violations and flattens them into a `Record<fieldName, errorMessage[]>` structure for frontend display.
 * 2. **AppError Resolution**: Maps custom domain errors (`NotFoundError`, `AppError`) to their specified HTTP status codes and machine-readable `code` identifiers.
 * 3. **OpSec Production Masking**: In `production`, internal 5xx errors are stripped of their generic messages to prevent information leakage, returning "Internal Server Error" instead.
 * 4. **Diagnostic Logging**: Every error is logged via `logger` with request metadata (`url`, `method`) for easier debugging.
 *
 * **EDGE CASE MANAGEMENT:**
 * - **Zod Errors**: Handled separately to provide structured field-level feedback.
 */

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const isProd = process.env.NODE_ENV === "production";

  // ── Zod validation errors (from SDK or route middleware) ──────────────────
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_root";
      fieldErrors[key] = fieldErrors[key] ?? [];
      fieldErrors[key].push(issue.message);
    }

    logger.warn(
      { url: req.url, method: req.method, fieldErrors },
      "Validation error",
    );

    res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      errors: fieldErrors,
    });
    return;
  }

  // ── Typed domain errors ───────────────────────────────────────────────────
  if (isAppError(err)) {
    const logLevel = err.statusCode >= 500 ? "error" : "warn";
    logger[logLevel](
      { code: err.code, statusCode: err.statusCode, url: req.url },
      err.message,
    );

    const body: Record<string, unknown> = {
      success: false,
      code: err.code,
      message:
        isProd && err.statusCode >= 500 ? "Internal Server Error" : err.message,
    };

    // Include field errors for ValidationError
    if (err instanceof ValidationError && err.fieldErrors) {
      body.errors = err.fieldErrors;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // ── Unknown / unhandled errors ────────────────────────────────────────────
  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error(
    { err, url: req.url, method: req.method },
    `Unhandled error: ${message}`,
  );

  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: isProd ? "Internal Server Error" : message,
  });
}
