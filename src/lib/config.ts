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
 * Dynamically connects to the primary MongoDB cluster (Control Plane).
 *
 * @param db - The target database name within the cluster.
 * @returns Fully established Mongoose connection singleton.
 *
 * **DETAILED EXECUTION:**
 * 1. **Singleton Check**: Returns the `cached.conn` immediately if a connection is already alive.
 * 2. **Promise Lock**: If no connection exists, creates a `cached.promise` to ensure multiple concurrent `dbConnect` calls don't spawn redundant database handshakes.
 * 3. **Cluster Handshake**: Invokes `mongoose.connect` with optimized pool settings (`maxPoolSize: 100`) for high-concurrency SaaS workloads.
 * 4. **State Commit**: Once resolved, persists the connection to `cached.conn` and clears the promise.
 *
 * **EDGE CASE MANAGEMENT:**
 * - Connection Error: If the handshake fails, resets `cached.promise` to `null` to allow subsequent retries to attempt a fresh connection.
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
