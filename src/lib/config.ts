import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: "./.env" });

// Global mongoose configuration (runs once)
mongoose.set("strictPopulate", false);
mongoose.set("strictQuery", false);

/**
 * Interface for the cached mongoose connection
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  listenersAttached: boolean;
}

// Global declaration for the mongoose cache
declare global {
  var mongoose: MongooseCache | undefined;
}

// Cache connection
let cached: MongooseCache | undefined = global.mongoose;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_URI_END = process.env.MONGODB_URI_END;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
    listenersAttached: false,
  };
}

/**
 * Add connection events only once
 */
function attachConnectionListeners(): void {
  if (!cached || cached.listenersAttached) return;

  mongoose.connection.on("connected", () => {
    console.log("✅ MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️ MongoDB disconnected");
  });

  cached.listenersAttached = true;
}

/**
 * Dynamically connects to the main application databases (e.g., services)
 * @param db - The database name to connect to
 */
async function dbConnect(db: string): Promise<typeof mongoose> {
  attachConnectionListeners();

  if (!cached) {
    throw new Error("Mongoose cache not initialized");
  }

  if (cached.conn) {
    return cached.conn;
  }

  // Access env var here, after dotenv.config() has run
  const URI = `${MONGODB_URI}${db}${MONGODB_URI_END}`;

  if (!URI || !MONGODB_URI) {
    throw new Error(
      "⚠️ Please define the MONGODB_URI environment variable inside .env",
    );
  }

  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      maxPoolSize: 50,
      retryWrites: true,
    };
    cached.promise = mongoose
      .connect(URI, opts)
      .then((mongoose) => mongoose)
      .catch((err) => {
        if (cached) cached.promise = null;
        throw err;
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
