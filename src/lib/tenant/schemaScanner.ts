import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRM_MODELS_BASE = path.resolve(__dirname, "../../model/saas/crm");
const MEET_MODELS_BASE = path.resolve(__dirname, "../../model/saas/meet");

interface FieldDefinition {
  key: string;
  label: string;
  type: string;
}

/**
 * Utility to scan internal backend models and extract schema fields.
 */
export class SchemaScanner {
  private static normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * Extracts fields from a model file within internal backend directories.
   */
  public static async getFieldsForCollection(
    clientCode: string,
    collectionName: string,
  ): Promise<FieldDefinition[]> {
    const searchDirs = [];
    if (fs.existsSync(CRM_MODELS_BASE)) searchDirs.push(CRM_MODELS_BASE);
    if (fs.existsSync(MEET_MODELS_BASE)) searchDirs.push(MEET_MODELS_BASE);

    const normTarget = this.normalizeName(collectionName);
    const fields: FieldDefinition[] = [];

    for (const modelsDir of searchDirs) {
      if (!fs.existsSync(modelsDir)) continue;

      try {
        const files = fs.readdirSync(modelsDir);

        const targetFile = files.find((f) => {
          const base = this.normalizeName(
            f.replace(/\.model\.ts$/, "").replace(/\.ts$/, ""),
          );
          return (
            base === normTarget ||
            base === normTarget.replace(/s$/, "") ||
            normTarget === base.replace(/s$/, "")
          );
        });

        if (!targetFile) continue;

        const content = fs.readFileSync(
          path.join(modelsDir, targetFile),
          "utf-8",
        );

        // Match: new Schema<...>( { ... },
        const schemaMatch = content.match(
          /new Schema(?:<[^>]+>)?\s*\(\s*{([\s\S]+?)}\s*[,)]/,
        );
        if (schemaMatch) {
          const schemaBody = schemaMatch[1];
          const lineRegex = /^\s*(?:"|')?([a-zA-Z0-9_.-]+)(?:"|')?\s*:/gm;
          let match;
          while ((match = lineRegex.exec(schemaBody)) !== null) {
            const key = match[1];
            if (
              [
                "clientCode",
                "__v",
                "_id",
                "createdAt",
                "updatedAt",
                "isArchived",
              ].includes(key)
            )
              continue;
            fields.push({
              key,
              label: key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (str) => str.toUpperCase()),
              type: "core",
            });
          }
        }

        // Fallback to Interface if Schema scanning yields nothing
        if (fields.length === 0) {
          const interfaceMatch = content.match(
            /interface [a-zA-Z0-9_]+\s+(?:extends\s+[a-zA-Z0-9_,\s<>]+)?\s*{([\s\S]+?)}/,
          );
          if (interfaceMatch) {
            const body = interfaceMatch[1];
            const lines = body.split("\n");
            lines.forEach((line) => {
              const m = line.match(
                /^\s*([a-zA-Z0-9_]+)\s*(\?)?:\s*[a-zA-Z|\[\]]+/,
              );
              if (m) {
                const key = m[1];
                if (
                  [
                    "updatedAt",
                    "createdAt",
                    "clientCode",
                    "_id",
                    "__v",
                  ].includes(key)
                )
                  return;
                fields.push({
                  key,
                  label: key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (str) => str.toUpperCase()),
                  type: "core",
                });
              }
            });
          }
        }

        if (fields.length > 0) return fields;
      } catch (err) {
        console.error(
          `Error scanning ${modelsDir} for ${collectionName}:`,
          err,
        );
      }
    }

    return fields;
  }
}
