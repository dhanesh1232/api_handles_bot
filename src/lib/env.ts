import dotenv from "dotenv";
import zod from "zod";

dotenv.config();

const envSchema = zod.object({
  PORT: zod.string().default("4000"),
  NODE_ENV: zod
    .enum(["development", "production", "test"])
    .default("development"),
  MONGODB_URI: zod.string().url(),
  MONGODB_URI_END: zod.string().optional(),
  REDIS_URL: zod.string().url().optional(),
  BASE_URL: zod.string().url().default("https://api.ecodrix.com"),
  npm_package_version: zod.string().optional(),
});

export const env = envSchema.parse(process.env);
