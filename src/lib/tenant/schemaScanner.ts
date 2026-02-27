import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for client projects - adjusted for monorepo structure
const PROJECTS_BASE = path.resolve(
  __dirname,
  "../../../../../projects/client/real",
);
const BACKEND_MODELS_BASE = path.resolve(__dirname, "../../model/saas/crm");

interface FieldDefinition {
  key: string;
  label: string;
  type: string;
}

/**
 * Utility to scan client projects and extract schema fields from source code.
 */
export class SchemaScanner {
  private static projectMap: Record<string, string> = {};

  /**
   * Finds the project directory for a given clientCode.
   */
  private static async findProjectDir(
    clientCode: string,
  ): Promise<string | null> {
    if (this.projectMap[clientCode]) return this.projectMap[clientCode];

    try {
      if (!fs.existsSync(PROJECTS_BASE)) {
        console.warn(`PROJECTS_BASE not found: ${PROJECTS_BASE}`);
        return null;
      }
      const projects = fs.readdirSync(PROJECTS_BASE);
      for (const project of projects) {
        const projectPath = path.join(PROJECTS_BASE, project);
        if (!fs.statSync(projectPath).isDirectory()) continue;

        const keysPath = path.join(projectPath, "src/lib/keys.ts");
        if (fs.existsSync(keysPath)) {
          const content = fs.readFileSync(keysPath, "utf-8");
          if (content.includes(clientCode)) {
            this.projectMap[clientCode] = projectPath;
            return projectPath;
          }
        }
      }
    } catch (err) {
      console.error("Error scanning projects directory:", err);
    }

    return null;
  }

  private static normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * Extracts fields from a model file.
   */
  public static async getFieldsForCollection(
    clientCode: string,
    collectionName: string,
  ): Promise<FieldDefinition[]> {
    const projectDir = await this.findProjectDir(clientCode);
    const searchDirs = [];
    if (projectDir) searchDirs.push(path.join(projectDir, "src/models"));
    if (fs.existsSync(BACKEND_MODELS_BASE))
      searchDirs.push(BACKEND_MODELS_BASE);

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

        // Use more robust regex to handle various schema and interface styles

        // Match: new Schema<...>( { ... },
        const schemaMatch = content.match(
          /new Schema(?:<[^>]+>)?\s*\(\s*{([\s\S]+?)}\s*[,)]/,
        );
        if (schemaMatch) {
          const schemaBody = schemaMatch[1];
          // Match keys like:   firstName: { ... }  or  "last-name": { ... }
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

        // Return immediately if fields found in higher priority directory
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

  /**
   * Lists all potential collections based on model files in the project.
   */
  public static async listProjectCollections(
    clientCode: string,
  ): Promise<string[]> {
    const projectDir = await this.findProjectDir(clientCode);
    if (!projectDir) return [];

    const modelsDir = path.join(projectDir, "src/models");
    if (!fs.existsSync(modelsDir)) return [];

    const collections: string[] = [];
    try {
      const files = fs.readdirSync(modelsDir);
      files.forEach((f) => {
        if (f.endsWith(".ts") && !f.endsWith(".d.ts")) {
          const name = f
            .replace(/\.model\.ts$/, "")
            .replace(/\.ts$/, "")
            .toLowerCase();
          // Skip internal or service directories if we accidentally matched them
          if (["index", "services"].includes(name)) return;
          collections.push(name);
        }
      });
    } catch (err) {
      console.error("Error listing collections in", modelsDir, err);
    }

    return collections;
  }
}
