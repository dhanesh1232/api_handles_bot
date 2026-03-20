import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRM_MODELS_BASE = path.resolve(__dirname, "@/model/saas/crm");
const MEET_MODELS_BASE = path.resolve(__dirname, "@/model/saas/meet");

interface FieldDefinition {
  key: string;
  label: string;
  type: string;
  dataType?: string;
}

/**
 * Utility to scan internal backend models and extract schema fields.
 */
export class SchemaScanner {
  private static normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * Introspects backend model files to extract schema field definitions for the UI.
   *
   * @param collectionName - The name of the collection to scan (e.g., 'leads', 'meetings').
   * @returns An array of `FieldDefinition` objects containing keys, labels, and types.
   *
   * **DETAILED EXECUTION:**
   * 1. **Normalization**: Canonicalizes the collection name to find matching files (e.g., handles pluralization).
   * 2. **File Discovery**: Searches across `@/model/saas/crm` and `@/model/saas/meet`.
   * 3. **Heuristic Parsing**:
   *    - Static Keys: Scans the file content for standard JS/TS property declarations.
   *    - Virtuals: Specifically looks for `.virtual()` calls to include computed properties.
   * 4. **Blacklisting**: Filters out reserved Mongoose keywords (e.g., `_id`, `__v`) and internal scoping fields like `clientCode`.
   */
  public static async getFieldsForCollection(
    _clientCode: string,
    collectionName: string,
  ): Promise<FieldDefinition[]> {
    const searchDirs = [];
    if (fs.existsSync(CRM_MODELS_BASE)) searchDirs.push(CRM_MODELS_BASE);
    if (fs.existsSync(MEET_MODELS_BASE)) searchDirs.push(MEET_MODELS_BASE);

    const normTarget = SchemaScanner.normalizeName(collectionName);
    const fields: FieldDefinition[] = [];

    const MONGOOSE_RESERVED = [
      "type",
      "required",
      "default",
      "enum",
      "ref",
      "trim",
      "lowercase",
      "unique",
      "sparse",
      "min",
      "max",
      "index",
      "validate",
      "get",
      "set",
      "alias",
      "toObject",
      "toJSON",
      "virtuals",
      "transform",
      "of",
      "timestamps",
      "versionKey",
      "autoIndex",
      "clientCode",
      "__v",
      "_id",
      "createdAt",
      "updatedAt",
      "isArchived",
    ];

    for (const modelsDir of searchDirs) {
      if (!fs.existsSync(modelsDir)) continue;

      try {
        const files = fs.readdirSync(modelsDir);

        const targetFile = files.find((f) => {
          const base = SchemaScanner.normalizeName(
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

        // 1. Scan for keys at the start of lines (with minimal indentation)
        // This covers both Schema objects and Interfaces.
        const lineRegex = /^\s{2,6}([a-zA-Z0-9_]+)\s*:/gm;
        let match;
        while ((match = lineRegex.exec(content)) !== null) {
          const key = match[1];
          if (MONGOOSE_RESERVED.includes(key)) continue;

          if (!fields.some((f) => f.key === key)) {
            const isProbablyDate =
              key.toLowerCase().includes("date") ||
              key.toLowerCase().includes("time") ||
              key.endsWith("At");

            fields.push({
              key,
              label: key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (str) => str.toUpperCase()),
              type: "core",
              dataType: isProbablyDate ? "date" : undefined,
            });
          }
        }

        // 2. Scan for virtuals: .virtual("name")
        const virtualMatches = content.matchAll(
          /\.virtual\s*\(\s*(?:"|')?([a-zA-Z0-9_.-]+)(?:"|')?\s*\)/g,
        );
        for (const vMatch of virtualMatches) {
          const key = vMatch[1];
          if (MONGOOSE_RESERVED.includes(key)) continue;

          if (!fields.some((f) => f.key === key)) {
            fields.push({
              key,
              label: key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (str) => str.toUpperCase()),
              type: "core",
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
