export class TemplateNotFoundError extends Error {
  constructor(templateName: string) {
    super(`Template "${templateName}" not found.`);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateMappingIncompleteError extends Error {
  missingPositions: number[];
  constructor(templateName: string, missingPositions: number[]) {
    super(
      `Template "${templateName}" has incomplete mapping for positions: ${missingPositions.join(", ")}`,
    );
    this.name = "TemplateMappingIncompleteError";
    this.missingPositions = missingPositions;
  }
}

export class TemplateVariableEmptyError extends Error {
  position: number;
  fieldPath?: string;
  constructor(position: number, fieldPath?: string) {
    super(
      `Template variable at position ${position}${fieldPath ? ` (${fieldPath})` : ""} is empty.`,
    );
    this.name = "TemplateVariableEmptyError";
    this.position = position;
    this.fieldPath = fieldPath;
  }
}

export class TemplateOutdatedError extends Error {
  templateName: string;
  oldVariablesCount: number;
  newVariablesCount: number;
  constructor(
    templateName: string,
    oldVariablesCount: number,
    newVariablesCount: number,
  ) {
    super(
      `Template "${templateName}" is outdated. Variables count changed from ${oldVariablesCount} to ${newVariablesCount}.`,
    );
    this.name = "TemplateOutdatedError";
    this.templateName = templateName;
    this.oldVariablesCount = oldVariablesCount;
    this.newVariablesCount = newVariablesCount;
  }
}

export class TemplateSyncFailedError extends Error {
  constructor(message: string) {
    super(`Template synchronization failed: ${message}`);
    this.name = "TemplateSyncFailedError";
  }
}
