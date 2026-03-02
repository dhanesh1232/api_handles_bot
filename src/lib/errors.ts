export class TemplateNotFoundError extends Error {
  constructor(templateName: string) {
    super(`Template "${templateName}" not found.`);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateSyncFailedError extends Error {
  constructor(message: string) {
    super(`Template synchronization failed: ${message}`);
    this.name = "TemplateSyncFailedError";
  }
}
