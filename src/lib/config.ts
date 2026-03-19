import { logger } from "@lib/logger";
import mongoose from "mongoose";

// Global mongoose configuration (runs once)
mongoose.set("strictPopulate", false);
mongoose.set("strictQuery", false);

/**
 * Interface for the cached mongoose connection
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// @ts-expect-error
let cached: MongooseCache = global.mongoose_cache;
if (!cached) {
  // @ts-expect-error
  cached = global.mongoose_cache = { conn: null, promise: null };
}

/**
 * Dynamically connects to the MongoDB cluster.
 * Note: Currently optimized as a singleton connection to avoid 'openUri' conflicts.
 */
async function dbConnect(db: string): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_URI_END = process.env.MONGODB_URI_END || "";

  if (!MONGODB_URI) {
    throw new Error("⚠️ MONGODB_URI missing in .env");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      maxPoolSize: 100,
      minPoolSize: 10,
      retryWrites: true,
    };

    const URI = `${MONGODB_URI}${db}${MONGODB_URI_END}`;
    logger.info(`🔌 Connecting to MongoDB [DB: ${db}]...`);

    cached.promise = mongoose.connect(URI, opts).then((m) => {
      logger.info(`✅ Initialized MongoDB connection via DB: ${db}`);
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
}

export { dbConnect };
