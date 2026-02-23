import mongoose, { type Connection } from "mongoose";

const connectionCache = new Map<string, Connection>();

/**
 * Creates or retrieves a Mongoose connection for a specific tenant.
 *
 * @param clientCode - Unique client identifier
 * @param dbUri - The connection string for the tenant's database
 * @returns A promise resolving to the Mongoose connection
 */
export async function getTenantConnection(
  clientCode: string,
  dbUri: string,
): Promise<Connection> {
  if (!dbUri) throw new Error(`No DB URI provided for client ${clientCode}`);

  // Return cached connection if it's still open
  if (connectionCache.has(clientCode)) {
    const cached = connectionCache.get(clientCode)!;
    if (cached.readyState === 1) return cached;
    // If connection is closed or closing, remove it and reconnect
    connectionCache.delete(clientCode);
  }

  try {
    const conn = mongoose.createConnection(dbUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      maxPoolSize: 2,
    });

    // Wait for the connection to be established
    await new Promise<void>((resolve, reject) => {
      conn.once("open", () => resolve());
      conn.once("error", reject);
    });

    connectionCache.set(clientCode, conn);
    console.log(`📡 Connected to external DB for tenant: ${clientCode}`);
    return conn;
  } catch (err: any) {
    console.error(
      `❌ Tenant DB Connection Error (${clientCode}):`,
      err.message,
    );
    throw err;
  }
}
