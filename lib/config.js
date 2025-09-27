import mongoose from "mongoose";

// Global mongoose configuration (runs once)
mongoose.set("strictPopulate", false);
mongoose.set("strictQuery", false);

// Cache connection
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
    listenersAttached: false,
  };
}

// Add connection events only once
function attachConnectionListeners() {
  if (cached.listenersAttached) return;

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

async function dbConnect() {
  attachConnectionListeners();

  if (cached.conn) {
    return cached.conn;
  }

  // Access env var here, after dotenv.config() has run
  const MONGODB_URI = process.env.MONGODB_URI;
  // console.log("MONGODB_URI inside dbConnect:", MONGODB_URI);

  if (!MONGODB_URI) {
    throw new Error(
      "⚠️ Please define the MONGODB_URI environment variable inside .env"
    );
  }

  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      maxPoolSize: 5,
      retryWrites: true,
    };

    cached.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((mongoose) => mongoose)
      .catch((err) => {
        cached.promise = null;
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
