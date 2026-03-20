/**
 * @module Lib/ConnectionManager
 * @responsibility High-performance singleton for orchestrating multi-tenant database connections.
 *
 * **GOAL:** Ensure strict data isolation in a multi-tenant environment by dynamically mapping subdomains/clientCodes to independent database clusters, while maintaining a lean memory footprint via connection pooling.
 */

import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import { ClientDataSource } from "@models/clients/dataSource";
import mongoose, { type Connection, type Model, type Schema } from "mongoose";

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * TenantConnectionManager — class-based singleton that maintains one
 * mongoose Connection per tenant (clientCode).
 */
class TenantConnectionManager {
  private readonly cache = new Map<string, Connection>();
  private readonly log = logger.child({ module: "TenantConnectionManager" });

  /**
   * Resolves a live, tenant-specific Mongoose Connection.
   *
   * @param clientCode - The unique identifier for the tenant (e.g., "APPLE", "EDX").
   * @returns {Promise<Connection>} A fully established and ready-to-use Mongoose connection.
   *
   * @throws {Error} If the `clientCode` is not found in the control-plane (ClientDataSource table) or the DB URI is invalid.
   *
   * **DETAILED EXECUTION:**
   * 1. **Control-Plane Sync**: Ensures the "services" (control-plane) database is connected.
   * 2. **Cache Lookup**: Checks the internal `cache` Map using the uppercase `clientCode`.
   * 3. **Liveness Heartbeat**: If cached, verifies `readyState` is 1 (connected) or 2 (connecting). If dead (stale), it prunes the cache.
   * 4. **Tenant Discovery**: Queries `ClientDataSource` to retrieve the encrypted or plain MongoDB URI for this specific tenant.
   * 5. **Cluster Handshake**: Calls `mongoose.createConnection` with production-grade settings:
   *    - `maxPoolSize: 10`: Limits connections to prevent DB resource exhaustion.
   *    - `bufferCommands: false`: Fails fast if connection is not ready, preventing infinite hangs.
   * 6. **Event Binding**: Attaches `error` and `disconnected` listeners to automatically cleanup the cache upon network failure.
   * 7. **Ready State Wait**: Awaits `.asPromise()` to ensure the connection is strictly "Ready" before returning to the caller.
   */
  async get(clientCode: string): Promise<Connection> {
    await dbConnect("services");
    const code = clientCode?.toUpperCase();

    // Return cached connection if it's live
    const cached = this.cache.get(code);
    if (cached) {
      if (cached.readyState === 1 || cached.readyState === 2) {
        return cached;
      }
      // Stale — remove so we reconnect below
      this.cache.delete(code);
    }

    // Lookup the tenant's DB URI from the control-plane
    const dataSource = await ClientDataSource.findOne({ clientCode: code });
    if (!dataSource) {
      throw new Error(`Data source not configured for tenant: ${code}`);
    }

    const uri: string =
      typeof dataSource.getUri === "function"
        ? dataSource.getUri()
        : (dataSource as any).uri;

    if (!uri) {
      throw new Error(`Invalid DB URI for tenant: ${code}`);
    }

    this.log.debug(
      { clientCode: code },
      "Establishing new tenant DB connection",
    );

    const conn = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 20000,
      maxPoolSize: 10,
      bufferCommands: false,
    });

    conn.on("error", (err) => {
      this.log.error({ err, clientCode: code }, "Tenant DB connection error");
      this.cache.delete(code);
    });

    conn.on("disconnected", () => {
      this.log.warn({ clientCode: code }, "Tenant DB disconnected");
      this.cache.delete(code);
    });

    await conn.asPromise();
    this.log.info({ clientCode: code }, "Tenant DB connected");

    this.cache.set(code, conn);
    return conn;
  }

  /**
   * Return (or compile) a Mongoose model on a tenant connection.
   *
   * @param conn - The resolved tenant-specific connection.
   * @param collectionName - The target MongoDB collection name (e.g., "leads").
   * @param schema - (Optional) The Mongoose Schema definition. If omitted, uses a "strict: false" schema for dynamic discovery.
   *
   * @returns {Model<T>} A compiled Mongoose Model bound to the tenant's connection.
   */
  model<T>(
    conn: Connection,
    collectionName: string,
    schema?: Schema<T> | any,
  ): Model<T> {
    if (conn.models[collectionName]) {
      return conn.models[collectionName] as Model<T>;
    }
    const s =
      schema ??
      new mongoose.Schema({}, { strict: false, collection: collectionName });
    return conn.model<T>(collectionName, s);
  }

  /** Number of cached connections (for health/admin endpoints). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Gracefully close all cached connections (e.g. during shutdown).
   *
   * **DETAILED EXECUTION:**
   * 1. **Snapshot**: Captures all current Map entries into a static array for stable iteration.
   * 2. **Parallel Termination**: Executes `conn.close()` for every tenant in parallel using `Promise.allSettled` to prevent one hanging connection from blocking the entire shutdown.
   * 3. **Cleanup**: Wipes the internal `cache` Map to free memory.
   */
  async closeAll(): Promise<void> {
    const entries = [...this.cache.entries()];
    await Promise.allSettled(
      entries.map(async ([code, conn]) => {
        try {
          await conn.close();
          this.log.info({ clientCode: code }, "Tenant DB connection closed");
        } catch (err) {
          this.log.warn(
            { err, clientCode: code },
            "Error closing tenant connection",
          );
        }
      }),
    );
    this.cache.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const tenantManager = new TenantConnectionManager();

// ─── Backward-compatible free functions ──────────────────────────────────────
/**
 * @param clientCode -
 */
export async function getTenantConnection(
  clientCode: string,
): Promise<Connection> {
  return tenantManager.get(clientCode);
}

export function getTenantModel<T>(
  conn: Connection,
  collectionName: string,
  schema?: Schema<T> | any,
): Model<T> {
  return tenantManager.model<T>(conn, collectionName, schema);
}
