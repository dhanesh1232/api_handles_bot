/**
 * lib/errors.ts
 *
 * Typed error hierarchy for the entire backend.
 * All thrown errors should extend AppError so the global error handler
 * can map them to the correct HTTP status automatically.
 *
 * Usage:
 *   throw new NotFoundError("Lead not found");
 *   throw new ValidationError("phone is required");
 *   throw new ConflictError("Lead with this phone already exists");
 */

// ─── Base ─────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  /** HTTP status code to respond with. */
  public readonly statusCode: number;
  /** Machine-readable error code for API consumers. */
  public readonly code: string;
  /** Whether this error should be logged at error level (vs warn). */
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── 400 Bad Request ──────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  /** Per-field validation issues (optional). */
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, 400, "VALIDATION_ERROR");
    this.fieldErrors = fieldErrors;
  }
}

// ─── 401 Unauthorized ─────────────────────────────────────────────────────────

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// ─── 403 Forbidden ────────────────────────────────────────────────────────────

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

// ─── 404 Not Found ────────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

// ─── 409 Conflict ─────────────────────────────────────────────────────────────

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

// ─── 422 Unprocessable ────────────────────────────────────────────────────────

export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(message, 422, "UNPROCESSABLE");
  }
}

// ─── 429 Rate Limited ─────────────────────────────────────────────────────────

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, 429, "RATE_LIMITED");
  }
}

// ─── Domain-specific (kept for backward compatibility) ────────────────────────

export class TemplateNotFoundError extends NotFoundError {
  constructor(templateName: string) {
    super(`Template "${templateName}"`);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateSyncFailedError extends AppError {
  constructor(message: string) {
    super(
      `Template synchronization failed: ${message}`,
      500,
      "TEMPLATE_SYNC_FAILED",
    );
    this.name = "TemplateSyncFailedError";
  }
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
