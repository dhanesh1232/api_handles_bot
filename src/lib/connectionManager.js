import mongoose from "mongoose";
import { ClientDataSource } from "../model/clients/dataSource.js";
import { dbConnect } from "./config.js";

const connectionCache = new Map();

/**
 * Dynamically connects to a tenant's database based on their clientCode.
 * Caches connections to avoid redundant handshakes.
 *
 * @param {string} clientCode
 * @returns {Promise<mongoose.Connection>}
 */
export async function getTenantConnection(clientCode) {
  await dbConnect("services");
  const code = clientCode?.toUpperCase();

  // Check cache first
  if (connectionCache.has(code)) {
    const cachedConn = connectionCache.get(code);
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

  const uri = dataSource.getUri();
  // console.log(uri);
  if (!uri) {
    throw new Error(`Invalid DB URI for tenant: ${code}`);
  }

  console.log(`🔌 Establishing dynamic connection to tenant: ${code}`);

  const conn = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 10000,
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
 * @param {mongoose.Connection} conn
 * @param {string} collectionName
 * @param {mongoose.Schema<T>} [schema] - Optional schema, defaults to an empty strict:false schema
 * @returns {mongoose.Model<T>}
 */
export function getTenantModel(conn, collectionName, schema) {
  // If model already compiled on this connection, return it
  if (conn.models[collectionName]) {
    return conn.models[collectionName];
  }

  const modelSchema =
    schema ||
    new mongoose.Schema({}, { strict: false, collection: collectionName });
  return conn.model(collectionName, modelSchema);
}
