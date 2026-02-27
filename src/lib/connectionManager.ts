import mongoose, { type Connection, type Model, type Schema } from "mongoose";
import { ClientDataSource } from "../model/clients/dataSource.ts";
import { dbConnect } from "./config.ts";

export const connectionCache = new Map<string, Connection>();

/**
 * Dynamically connects to a tenant's database based on their clientCode.
 * Caches connections to avoid redundant handshakes.
 *
 * @param clientCode - The client code to connect to
 * @returns A promise resolving to the mongoose connection
 */
export async function getTenantConnection(
  clientCode: string,
): Promise<Connection> {
  await dbConnect("services");
  const code = clientCode?.toUpperCase();

  // Check cache first
  if (connectionCache.has(code)) {
    const cachedConn = connectionCache.get(code)!;
    // 1 = connected, 2 = connecting
    if (
      cachedConn.models &&
      (cachedConn.readyState === 1 || cachedConn.readyState === 2)
    ) {
      return cachedConn;
    }
    // If connection is closed/closing, remove from cache
    connectionCache.delete(code);
  }

  // Fetch data source config
  const dataSource = await ClientDataSource.findOne({ clientCode: code });
  if (!dataSource) {
    throw new Error(`Data source not configured for tenant: ${code}`);
  }

  const uri =
    typeof dataSource.getUri === "function"
      ? dataSource.getUri()
      : (dataSource as any).uri;
  if (!uri) {
    throw new Error(`Invalid DB URI for tenant: ${code}`);
  }

  try {
    const url = new URL(
      uri.startsWith("mongodb+srv")
        ? uri
        : uri.replace("mongodb://", "http://"),
    );
    console.log(
      `🔌 Establishing dynamic connection to tenant: ${code} (Host: ${url.host})`,
    );
  } catch (e) {
    console.log(
      `🔌 Establishing dynamic connection to tenant: ${code} (URI format unusual)`,
    );
  }

  const conn = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 20000, // Increased timeout
    maxPoolSize: 10,
    bufferCommands: false, // Fail fast if not connected
  });

  // Basic event handling
  conn.on("error", (err) => {
    console.error(`❌ Tenant DB Connection Error [${code}]:`, err);
    connectionCache.delete(code);
  });

  conn.on("disconnected", () => {
    console.warn(`⚠️ Tenant DB Disconnected [${code}]`);
    connectionCache.delete(code);
  });

  // Wait for connection to be ready
  await conn.asPromise();

  connectionCache.set(code, conn);
  return conn;
}

/**
 * Helper to get a dynamic model on a tenant connection.
 * Useful since we don't know the exact schemas beforehand.
 *
 * @template T
 * @param conn - The dynamic mongoose connection
 * @param collectionName - Name of the collection to bind to
 * @param schema - Optional schema, defaults to an empty strict:false schema
 * @returns Mongoose Model
 */
export function getTenantModel<T>(
  conn: Connection,
  collectionName: string,
  schema?: Schema<T> | any,
): Model<T> {
  // If model already compiled on this connection, return it
  if (conn.models[collectionName]) {
    return conn.models[collectionName] as Model<T>;
  }

  const modelSchema =
    schema ||
    new mongoose.Schema({}, { strict: false, collection: collectionName });
  return conn.model<T>(collectionName, modelSchema);
}
